import { defineConfig } from 'vitest/config';
import path from 'path';

const configuratorSrc = path.resolve(__dirname, '../configurator/src');

export default defineConfig({
	test: {
		dir: 'src/__tests__',
		environment: 'node',
		globals: true,
		setupFiles: ['./src/test-setup.ts'],
		globalSetup: './src/test-setup-global.ts',
		coverage: {
			enabled: process.env.argv?.includes('--coverage'),
			reporter: ['text', 'json-summary', 'json'],
			reportOnFailure: true,
			include: ['src/**/*'],
			exclude: ['src/__tests__/*', 'src/test-setup*.ts'],
		},
	},
	resolve: {
		// Order matters: the CLI's own `@/cli/*` imports must win over the
		// configurator-wide `@/*` alias that the CLI uses to reach server code.
		alias: [
			{ find: /^@\/cli\/(.*)$/, replacement: path.resolve(__dirname, './src') + '/$1' },
			{ find: '@', replacement: configuratorSrc },
		],
	},
});
