/**
 * Excalidraw to SVG worker script
 * Runs in a child process with real node_modules (not bundled)
 * to avoid jsdom bundling issues
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Read input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => inputData += chunk);
process.stdin.on('end', async () => {
    try {
        const { elements, appState, files } = JSON.parse(inputData);

        // Load the polyfill and excalidraw utils
        // When copied to dist/, node_modules is at ../node_modules
        const nodeModulesDir = path.join(__dirname, '../node_modules');
        const canvasPolyfillPath = path.join(nodeModulesDir, 'canvas-5-polyfill/canvas.js');
        const excalidrawUtilsPath = path.join(nodeModulesDir, '@excalidraw/utils/dist/excalidraw-utils.min.js');

        const canvasPolyfillCode = fs.readFileSync(canvasPolyfillPath, 'utf8');
        const excalidrawUtilsCode = fs.readFileSync(excalidrawUtilsPath, 'utf8');

        // Create the export script
        const exportScript = `
            <!DOCTYPE html>
            <html>
            <head>
                <script>
                    class CanvasRenderingContext2D {}
                    window.devicePixelRatio = 1;
                </script>
                <script>${canvasPolyfillCode}</script>
                <script>${excalidrawUtilsCode}</script>
                <script>
                    (async function() {
                        try {
                            const elements = ${JSON.stringify(elements)};
                            const appState = ${JSON.stringify({
                                ...appState,
                                exportWithDarkMode: false,
                                exportBackground: false,
                            })};
                            const files = ${JSON.stringify(files)};

                            const svg = await ExcalidrawUtils.exportToSvg({
                                elements,
                                appState,
                                files,
                            });

                            document.body.appendChild(svg);
                        } catch (error) {
                            const errorDiv = document.createElement('div');
                            errorDiv.id = 'excalidraw-error';
                            errorDiv.textContent = error.message || 'Unknown error';
                            document.body.appendChild(errorDiv);
                        }
                    })();
                </script>
            </head>
            <body></body>
            </html>
        `;

        const dom = new JSDOM(exportScript, {
            runScripts: 'dangerously',
            resources: 'usable',
        });

        // Wait for SVG to be created
        let checks = 100;
        while (checks > 0) {
            checks--;

            const errorDiv = dom.window.document.body.querySelector('#excalidraw-error');
            if (errorDiv) {
                throw new Error(errorDiv.textContent);
            }

            const svg = dom.window.document.body.querySelector('svg');
            if (svg) {
                dom.window.close();
                // Use stdout.write to avoid console.log buffer truncation
                process.stdout.write(svg.outerHTML, () => {
                    process.exit(0);
                });
                return;
            }

            await new Promise(r => setTimeout(r, 20));
        }

        dom.window.close();
        throw new Error('SVG was not created after timeout');

    } catch (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
    }
});
