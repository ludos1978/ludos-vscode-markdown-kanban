const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

const copyStaticFilesPlugin = {
	name: 'copy-static-files',
	setup(build) {
		build.onEnd(() => {
			if (!fs.existsSync('dist')) {
				fs.mkdirSync('dist', { recursive: true });
			}

			// Copy build scripts required by Marp CLI
			const marpRequiredFiles = ['esbuild.js', 'watch.js'];
			marpRequiredFiles.forEach(file => {
				const srcFile = path.join(process.cwd(), file);
				const distFile = path.join('dist', file);
				if (fs.existsSync(srcFile)) {
					fs.copyFileSync(srcFile, distFile);
					console.log(`Copied ${file} to dist/ for Marp CLI`);
				}
			});

			// Create watch.js placeholder if it doesn't exist
			const watchJsPath = path.join('dist', 'watch.js');
			if (!fs.existsSync(watchJsPath)) {
				const watchJsContent = `#!/usr/bin/env node
// Watch script placeholder for Marp CLI
console.log('Marp watch script placeholder');
`;
				fs.writeFileSync(watchJsPath, watchJsContent);
				console.log('Created watch.js placeholder for Marp CLI');
			}

			const srcHtmlDir = 'src/html';
			const distHtmlDir = 'dist/src/html';

			if (fs.existsSync(srcHtmlDir)) {
				fs.mkdirSync(distHtmlDir, { recursive: true });

// JS files that would be bundled (currently disabled - loading individual scripts)
			// To re-enable bundling, populate this set and enable the frontend bundle in esbuild
			const bundledJsFiles = new Set([
				// Bundling disabled for now - all files are loaded individually
				'main.js'  // Only skip main.js (bundle entry point)
			]);

// Recursive function to copy directory contents with exclusions
			function copyDirRecursive(src, dist, isUtilsDir = false) {
				const files = fs.readdirSync(src);
				files.forEach(file => {
					const srcFile = path.join(src, file);
					const distFile = path.join(dist, file);
					const stat = fs.statSync(srcFile);

					// Skip hidden files/directories (starting with .)
					if (file.startsWith('.')) {
						console.log(`Skipping hidden file/directory: ${srcFile}`);
						return;
					}

					// Skip test files and directories
					if (file.includes('test') || file.includes('spec')) {
						console.log(`Skipping test file/directory: ${srcFile}`);
						return;
					}

					// Skip temporary files
					if (file.endsWith('.tmp') || file.endsWith('.temp')) {
						console.log(`Skipping temporary file: ${srcFile}`);
						return;
					}

					// Skip map files (sourcemaps)
					if (file.endsWith('.map')) {
						console.log(`Skipping sourcemap file: ${srcFile}`);
						return;
					}

					// Skip files that are bundled (e.g., main.js entry point)
					if (file.endsWith('.js') && bundledJsFiles.has(file)) {
						console.log(`Skipping bundled file: ${srcFile}`);
						return;
					}

					if (stat.isDirectory()) {
						// Check if this is the utils directory (all files in utils are bundled)
						const enteringUtils = file === 'utils';
						// Create subdirectory and copy its contents
						fs.mkdirSync(distFile, { recursive: true });
						copyDirRecursive(srcFile, distFile, enteringUtils);
					} else if (stat.isFile()) {
						// Copy file
						fs.copyFileSync(srcFile, distFile);
						console.log(`Copied ${srcFile} to ${distFile}`);
					}
				});
			}				copyDirRecursive(srcHtmlDir, distHtmlDir);
			}

			// Copy markdown-it 14.x from node_modules to dist/src/html for local loading
			const markdownItSrc = path.join('node_modules', 'markdown-it', 'dist', 'markdown-it.min.js');
			const markdownItDist = path.join('dist', 'src', 'html', 'markdown-it.min.js');
			if (fs.existsSync(markdownItSrc)) {
				fs.mkdirSync(path.dirname(markdownItDist), { recursive: true });
				fs.copyFileSync(markdownItSrc, markdownItDist);
				console.log(`Copied markdown-it 14.x to ${markdownItDist}`);
			} else {
				console.warn(`Warning: markdown-it not found at ${markdownItSrc}`);
			}

			// Convert markdown-it-media-lib CommonJS modules to browser-compatible IIFE format
			const mediaLibDir = 'marp-engine/engine/markdown-it-media-lib';
			
			if (fs.existsSync(mediaLibDir)) {
				const modules = ['media-type.js', 'parse.js', 'render.js', 'ruler.js', 'plugin.js'];
				let browserScript = `// Auto-generated browser-compatible markdown-it-media-lib
(function() {
    'use strict';
    
    // Create module system
    const modules = {};
    const exports = {};
    
    // Simple Token constructor for browser compatibility
    function Token(type, tag, nesting) {
        this.type = type;
        this.tag = tag;
        this.nesting = nesting;
        this.attrs = [];
        this.content = '';
        this.markup = '';
        this.info = '';
        this.meta = null;
        this.block = false;
        this.hidden = false;
        this.children = null;
    }
    Token.prototype.attrGet = function(name) {
        if (!this.attrs) return null;
        for (let i = 0; i < this.attrs.length; i++) {
            if (this.attrs[i][0] === name) return this.attrs[i][1];
        }
        return null;
    };
    Token.prototype.attrSet = function(name, value) {
        if (!this.attrs) this.attrs = [];
        const idx = this.attrs.findIndex(attr => attr[0] === name);
        if (idx >= 0) {
            this.attrs[idx][1] = value;
        } else {
            this.attrs.push([name, value]);
        }
    };
    
    // Mock require function
    function require(path) {
        if (path === 'markdown-it') return window.markdownit;
        if (path === 'markdown-it/lib/token.mjs') return { default: Token };
        if (path === 'markdown-it/lib/common/utils.mjs') return { isWhiteSpace: window.markdownit().utils.isWhiteSpace };
        if (path === './media-type.js') return modules['media-type'];
        if (path === './parse.js') return modules['parse'];
        if (path === './render.js') return modules['render'];
        if (path === './ruler.js') return modules['ruler'];
        if (path === './plugin.js') return modules['plugin'];
        throw new Error('Module not found: ' + path);
    }

`;

				// Convert each module to IIFE format
				modules.forEach(moduleFile => {
					const modulePath = path.join(mediaLibDir, moduleFile);
					if (fs.existsSync(modulePath)) {
						const moduleContent = fs.readFileSync(modulePath, 'utf8');
						const moduleName = moduleFile.replace('.js', '');
						
						browserScript += `
    // Module: ${moduleName}
    (function() {
        const module = { exports: {} };
        const exports = module.exports;
        
        ${moduleContent}
        
        modules['${moduleName}'] = module.exports;
    })();
`;
					}
				});

				browserScript += `
    // Export the main plugin function
    if (modules['plugin'] && modules['plugin'].markdownItMedia) {
        window.markdownItMediaCustom = modules['plugin'].markdownItMedia;
        console.log('markdown-it-media-lib loaded successfully via IIFE conversion');
    } else {
        console.error('Failed to export markdownItMedia function');
    }
})();
`;

				// Write the converted browser script
				const browserScriptPath = path.join(distHtmlDir, 'markdown-it-media-browser.js');
				fs.writeFileSync(browserScriptPath, browserScript);
				console.log(`Generated browser-compatible markdown-it-media-lib at ${browserScriptPath}`);
			}
		});
	}
};

async function main() {
	// Backend bundle (extension.ts -> dist/extension.js)
	const backendCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', 'tslib', 'emitter', 'jsdom', 'canvas'],
		logLevel: 'silent',
		plugins: [
			copyStaticFilesPlugin,
			esbuildProblemMatcherPlugin,
		],
	});

	// Frontend bundle is DISABLED - loading individual scripts instead
	// To re-enable, uncomment the frontendCtx and update watch/rebuild calls
	// const frontendCtx = await esbuild.context({
	// 	entryPoints: ['src/html/main.js'],
	// 	bundle: true,
	// 	format: 'iife',
	// 	minify: production,
	// 	sourcemap: !production,
	// 	platform: 'browser',
	// 	outfile: 'dist/src/html/bundle.js',
	// });

	if (watch) {
		await backendCtx.watch();
	} else {
		await backendCtx.rebuild();
		await backendCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
