/**
 * Excalidraw to SVG worker script
 * Uses Puppeteer (headless browser) for full Excalidraw rendering support
 * including modern features like custom fonts (fontFamily 5+)
 */

const puppeteer = require('puppeteer');

// Read input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => inputData += chunk);
process.stdin.on('end', async () => {
    let browser;
    try {
        const { elements, appState, files } = JSON.parse(inputData);

        // Launch headless browser
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        // Create HTML page with Excalidraw loaded via ES modules from esm.sh
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <body>
                <script type="module">
                    import Excalidraw from "https://esm.sh/@excalidraw/excalidraw@0.17.0";

                    window.renderExcalidraw = async function(elements, appState, files) {
                        try {
                            const hasContent = elements.length > 0;
                            const exportAppState = {
                                ...appState,
                                exportWithDarkMode: false,
                                exportBackground: false,
                                exportPadding: hasContent ? 0 : 20
                            };

                            const svg = await Excalidraw.exportToSvg({
                                elements,
                                appState: exportAppState,
                                files: files || {}
                            });

                            return svg.outerHTML;
                        } catch (error) {
                            throw new Error(error.message || 'Export failed');
                        }
                    };

                    // Signal that we're ready
                    window.excalidrawReady = true;
                </script>
            </body>
            </html>
        `;

        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        // Wait for Excalidraw module to load and be ready
        await page.waitForFunction(() => window.excalidrawReady === true, { timeout: 60000 });

        // Call the render function with our data
        const svgString = await page.evaluate(async (elements, appState, files) => {
            return await window.renderExcalidraw(elements, appState, files);
        }, elements, appState || {}, files || {});

        await browser.close();

        // Output SVG to stdout
        process.stdout.write(svgString, () => {
            process.exit(0);
        });

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
    }
});
