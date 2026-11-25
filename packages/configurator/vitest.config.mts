import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	root: path.resolve(__dirname, './src'),
	test: {
		dir: path.resolve(__dirname, './src/__tests__'),
		environment: 'node',
		globals: true,
		setupFiles: [ './test-setup.ts' ],
		globalSetup: './test-setup-global.ts',
		coverage: {
			enabled: process.env.argv?.includes('--coverage'),
			reporter: ['text', 'json-summary', 'json'],
			reportOnFailure: true,
			include: ['**/*'],
			exclude: ['__tests__/*', '*.*', 'env/*', 'app/**/*', 'components/**/*', 'pages/**/*'],
		},
	},
	resolve: {
		// Root-level files that source imports through the `@` alias (they live next to
		// package.json, outside src/) must be matched before the general `@` alias.
		alias: [
			{ find: /^@\/public\/(.*)$/, replacement: path.resolve(__dirname, './public') + '/$1' },
			{ find: '@/tailwind.config', replacement: path.resolve(__dirname, './tailwind.config.ts') },
			{ find: '@', replacement: path.resolve(__dirname, './src') },
		],
	},
});
