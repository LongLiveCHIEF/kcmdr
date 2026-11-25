import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reloadEnvironment } from '@/server/helpers/utils';

const defaults = {
	USER: 'pi',
	RATOS_CONFIGURATION_PATH: '/home/pi/ratos-configurator/packages/configurator/configuration',
	KLIPPER_CONFIG_PATH: '/home/pi/printer_data/config',
	RATOS_SCRIPT_DIR: '/home/pi/ratos-configurator/packages/configurator/src/scripts',
	KLIPPER_DIR: '/home/pi/klipper',
	KLIPPER_ENV: '/home/pi/klippy-env',
	MOONRAKER_DIR: '/home/pi/moonraker',
	LOG_FILE: '/home/pi/printer_data/logs/ratos-configurator.log',
	RATOS_DATA_DIR: '/home/pi/printer_data/ratos',
};

const toEnvFile = (values: Record<string, string>) =>
	Object.entries(values)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');

describe('loadEnvironment', () => {
	let dir: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(async () => {
		originalEnv = { ...process.env };
		dir = await mkdtemp(path.join(tmpdir(), 'ratos-env-'));
		await writeFile(path.join(dir, '.env'), toEnvFile(defaults));
	});

	afterEach(async () => {
		process.env = originalEnv;
		// Leave the environment as the global test setup loaded it for later tests.
		reloadEnvironment();
		await rm(dir, { recursive: true, force: true });
	});

	it('uses the package defaults without a printer environment file', () => {
		delete process.env.RATOS_ENV_FILE;
		const env = reloadEnvironment(path.join(dir, '.env'));
		expect(env.KLIPPER_DIR).toBe('/home/pi/klipper');
	});

	it('lets the printer environment file (RATOS_ENV_FILE) override the package defaults', async () => {
		const printerEnv = path.join(dir, 'ratos-configurator.env');
		await writeFile(printerEnv, toEnvFile({ KLIPPER_DIR: '/home/printer/klipper', USER: 'printer' }));
		process.env.RATOS_ENV_FILE = printerEnv;

		const env = reloadEnvironment(path.join(dir, '.env'));

		expect(env.KLIPPER_DIR).toBe('/home/printer/klipper');
		expect(process.env.KLIPPER_DIR).toBe('/home/printer/klipper');
		// Settings the printer file doesn't set keep their defaults.
		expect(env.MOONRAKER_DIR).toBe('/home/pi/moonraker');
	});

	it('ignores a RATOS_ENV_FILE that does not exist', () => {
		process.env.RATOS_ENV_FILE = path.join(dir, 'missing.env');
		const env = reloadEnvironment(path.join(dir, '.env'));
		expect(env.KLIPPER_DIR).toBe('/home/pi/klipper');
	});
});
