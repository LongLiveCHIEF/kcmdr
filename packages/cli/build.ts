import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pinoshim from './src/pino-shim';

let wasmPlugin = {
	name: 'wasm',
	setup(build: any) {
		// Resolve ".wasm" files to a path with a namespace
		build.onResolve({ filter: /\.wasm$/ }, (args: any) => {
			// If this is the import inside the stub module, import the
			// binary itself. Put the path in the "wasm-binary" namespace
			// to tell our binary load callback to load the binary file.
			if (args.namespace === 'wasm-stub') {
				return {
					path: args.path,
					namespace: 'wasm-binary',
				};
			}

			// Otherwise, generate the JavaScript stub module for this
			// ".wasm" file. Put it in the "wasm-stub" namespace to tell
			// our stub load callback to fill it with JavaScript.
			//
			// Resolve relative paths to absolute paths here since this
			// resolve callback is given "resolveDir", the directory to
			// resolve imports against.
			if (args.resolveDir === '') {
				return; // Ignore unresolvable paths
			}
			return {
				path: path.isAbsolute(args.path) ? args.path : path.join(args.resolveDir, args.path),
				namespace: 'wasm-stub',
			};
		});

		// Virtual modules in the "wasm-stub" namespace are filled with
		// the JavaScript code for compiling the WebAssembly binary. The
		// binary itself is imported from a second virtual module.
		build.onLoad({ filter: /.*/, namespace: 'wasm-stub' }, async (args: any) => ({
			contents: `import wasm from ${JSON.stringify(args.path)}
        export default (imports) =>
          WebAssembly.instantiate(wasm, imports).then(
            result => result.instance.exports)`,
		}));

		// Virtual modules in the "wasm-binary" namespace contain the
		// actual bytes of the WebAssembly file. This uses esbuild's
		// built-in "binary" loader instead of manually embedding the
		// binary data inside JavaScript code ourselves.
		build.onLoad({ filter: /.*/, namespace: 'wasm-binary' }, async (args: any) => ({
			contents: await fs.promises.readFile(args.path),
			loader: 'binary',
		}));
	},
};

// zx's ESM entry loads its CommonJS build through createRequire(), which esbuild can't follow,
// so the bundle would still need zx at runtime. Bundle the CommonJS build (what require.resolve
// picks) directly instead.
const zxCjsPlugin = {
	name: 'zx-cjs',
	setup(build: any) {
		const zxCjs = createRequire(import.meta.url).resolve('zx');
		build.onResolve({ filter: /^zx$/ }, () => ({ path: zxCjs }));
	},
};

const outdir = 'dist';

await fs.promises.rm(outdir, { recursive: true, force: true });

await esbuild.build({
	entryPoints: {
		ratos: 'src/ratos.tsx',
	},
	bundle: true,
	// Everything is bundled (including zx) so the released CLI runs without node_modules.
	platform: 'node',
	outExtension: { '.js': '.mjs' },
	outdir,
	target: 'node18',
	format: 'esm',
	inject: ['src/cjs-shim.ts'],
	plugins: [wasmPlugin, zxCjsPlugin, pinoshim({ transports: ['pino-pretty'] })],
});

// ink's yoga-wasm-web loads ./yoga.wasm relative to the bundle at runtime, so ship the
// copy that matches the installed ink next to ratos.mjs.
const inkRequire = createRequire(createRequire(import.meta.url).resolve('ink'));
await fs.promises.copyFile(inkRequire.resolve('yoga-wasm-web/dist/yoga.wasm'), path.join(outdir, 'yoga.wasm'));
