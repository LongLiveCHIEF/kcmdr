import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@/server/helpers/utils';

// The CLI uses the configurator's environment files. loadEnvironment() resolves them
// from the cwd by default, which is packages/cli when tests run, so pick the file
// explicitly from the configurator package with the same precedence it uses for tests.
const configuratorDir = path.resolve(__dirname, '../../configurator');

export function loadConfiguratorTestEnvironment() {
	const envFile = ['.env.test.local', '.env.test', '.env.local', '.env']
		.map((name) => path.join(configuratorDir, name))
		.find((file) => existsSync(file));
	return loadEnvironment(envFile);
}
