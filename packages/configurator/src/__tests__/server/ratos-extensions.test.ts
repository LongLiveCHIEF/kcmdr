import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureRatosExtensions } from '@/server/helpers/ratos-extensions';

const RATOS_KLIPPY_FILES = [
	'gcode_shell_command.py',
	'ratos_homing.py',
	'linear_movement_vibrations.py',
	'z_offset_probe.py',
	'resonance_generator.py',
	'ratos.py',
	'beacon_mesh.py',
	'beacon_true_zero_correction.py',
	'beacon_adaptive_heat_soak.py',
	'fastconfig.py',
	'named_offsets.py',
	'beacon_user_z_offset.py',
	'ratos_dual_carriage_extras.py',
];

interface RegisteredExtension {
	extensionName: string;
	path: string;
	fileName: string;
	isKinematics?: boolean;
}

describe('ensureRatosExtensions', () => {
	let root: string;
	let originalEnv: NodeJS.ProcessEnv;
	let klipperDir: string;
	let configDir: string;
	let dataDir: string;

	const git = (...args: string[]) =>
		execFileSync('git', ['-C', klipperDir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args]);

	const readRegistry = async (file: 'klippy-extensions.json' | 'moonraker-extensions.json') =>
		JSON.parse(await readFile(path.join(dataDir, file), 'utf8')) as RegisteredExtension[];
	const writeRegistry = (
		file: 'klippy-extensions.json' | 'moonraker-extensions.json',
		extensions: RegisteredExtension[],
	) => writeFile(path.join(dataDir, file), JSON.stringify(extensions));
	const registeredNames = async () => (await readRegistry('klippy-extensions.json')).map((e) => e.extensionName).sort();

	beforeEach(async () => {
		originalEnv = { ...process.env };
		root = await mkdtemp(path.join(os.tmpdir(), 'ratos-ensure-extensions-'));
		klipperDir = path.join(root, 'klipper');
		configDir = path.join(root, 'configuration');
		dataDir = path.join(root, 'data');
		const moonrakerDir = path.join(root, 'moonraker');

		// A Klipper repository without gcode_shell_command (upstream Klipper)
		await mkdir(path.join(klipperDir, 'klippy', 'extras'), { recursive: true });
		await mkdir(path.join(klipperDir, 'klippy', 'kinematics'), { recursive: true });
		await writeFile(path.join(klipperDir, 'klippy', 'extras', 'probe.py'), '# probe\n');
		execFileSync('git', ['init', '-q', klipperDir]);
		git('add', '.');
		git('commit', '-q', '-m', 'init');

		await mkdir(path.join(configDir, 'klippy'), { recursive: true });
		for (const file of RATOS_KLIPPY_FILES) {
			await writeFile(path.join(configDir, 'klippy', file), `# ${file}\n`);
		}
		await mkdir(path.join(root, 'beacon'), { recursive: true });
		await writeFile(path.join(root, 'beacon', 'beacon.py'), '# beacon\n');
		await mkdir(path.join(moonrakerDir, 'moonraker', 'components'), { recursive: true });
		await mkdir(path.join(root, 'moonraker-timelapse', 'component'), { recursive: true });
		await writeFile(path.join(root, 'moonraker-timelapse', 'component', 'timelapse.py'), '# timelapse\n');
		await mkdir(dataDir, { recursive: true });

		delete process.env.BEACON_DIR;
		process.env.KLIPPER_DIR = klipperDir;
		process.env.MOONRAKER_DIR = moonrakerDir;
		process.env.RATOS_CONFIGURATION_PATH = configDir;
		process.env.RATOS_DATA_DIR = dataDir;
	});

	afterEach(async () => {
		process.env = originalEnv;
		await rm(root, { recursive: true, force: true });
	});

	test('registers every RatOS extension on a new installation', async () => {
		await ensureRatosExtensions();

		expect(await registeredNames()).toEqual(
			[
				'beacon',
				'beacon_adaptive_heatsoak_extension',
				'beacon_mesh_extension',
				'beacon_true_zero_correction_extension',
				'beacon_user_z_offset',
				'fastconfig',
				'gcode_shell_extension',
				'linear_movement_analysis',
				'named_offsets',
				'ratos_dual_carriage_extras',
				'ratos_extension',
				'ratos_homing_extension',
				'resonance_generator_extension',
				'z_offset_probe_extension',
			].sort(),
		);
		const ratos = (await readRegistry('klippy-extensions.json')).find((e) => e.extensionName === 'ratos_extension');
		expect(path.join(ratos!.path, ratos!.fileName)).toBe(path.join(configDir, 'klippy', 'ratos.py'));
		expect((await readRegistry('moonraker-extensions.json')).map((e) => e.extensionName)).toEqual(['timelapse']);
	});

	test('changes nothing when everything is registered', async () => {
		await ensureRatosExtensions();
		const before = await readRegistry('klippy-extensions.json');

		const report = await ensureRatosExtensions();

		expect(report).toEqual(['All RatOS extensions are registered.']);
		expect(await readRegistry('klippy-extensions.json')).toEqual(before);
	});

	test("uses the Klipper repository's gcode_shell_command when it ships one (Kalico)", async () => {
		await ensureRatosExtensions();
		await writeFile(path.join(klipperDir, 'klippy', 'extras', 'gcode_shell_command.py'), '# kalico\n');
		git('add', '.');
		git('commit', '-q', '-m', 'kalico gcode_shell_command');

		await ensureRatosExtensions();

		expect(await registeredNames()).not.toContain('gcode_shell_extension');
		expect(await readFile(path.join(klipperDir, 'klippy', 'extras', 'gcode_shell_command.py'), 'utf8')).toBe(
			'# kalico\n',
		);
	});

	test('re-registers an extension whose file moved', async () => {
		const oldDir = path.join(root, 'old-configuration', 'klippy');
		await mkdir(oldDir, { recursive: true });
		await writeFile(path.join(oldDir, 'ratos.py'), '# old\n');
		await writeRegistry('klippy-extensions.json', [
			{ extensionName: 'ratos_extension', path: oldDir, fileName: 'ratos.py' },
		]);

		await ensureRatosExtensions();

		const ratos = (await readRegistry('klippy-extensions.json')).find((e) => e.extensionName === 'ratos_extension');
		expect(ratos?.path).toBe(path.join(configDir, 'klippy'));
	});

	test('unregisters retired extensions and removes their dangling links', async () => {
		const retiredFile = path.join(root, 'gone', 'ratos_hybrid_corexy.py');
		const retiredLink = path.join(klipperDir, 'klippy', 'kinematics', 'ratos_hybrid_corexy.py');
		await symlink(retiredFile, retiredLink);
		await writeRegistry('klippy-extensions.json', [
			{
				extensionName: 'ratos_hybrid_corexy',
				path: path.dirname(retiredFile),
				fileName: 'ratos_hybrid_corexy.py',
				isKinematics: true,
			},
		]);

		await ensureRatosExtensions();

		expect(await registeredNames()).not.toContain('ratos_hybrid_corexy');
		expect(await lstat(retiredLink).catch(() => null)).toBeNull();
	});

	test('leaves extensions registered by third parties alone', async () => {
		const thirdParty = path.join(root, 'third-party');
		await mkdir(thirdParty, { recursive: true });
		await writeFile(path.join(thirdParty, 'my_extension.py'), '# mine\n');
		await writeRegistry('klippy-extensions.json', [
			{ extensionName: 'my_extension', path: thirdParty, fileName: 'my_extension.py' },
		]);

		const report = await ensureRatosExtensions();

		expect(await registeredNames()).toContain('my_extension');
		expect(report.some((line) => line.includes('Unexpected Klipper extension my_extension'))).toBe(true);
	});

	test('reports extensions whose files are missing and registers the rest', async () => {
		await rm(path.join(root, 'beacon'), { recursive: true });

		const report = await ensureRatosExtensions();

		expect(await registeredNames()).not.toContain('beacon');
		expect(await registeredNames()).toContain('ratos_extension');
		expect(report.some((line) => line.startsWith('WARNING: Could not register Klipper extension beacon'))).toBe(true);
		expect(existsSync(path.join(dataDir, 'klippy-extensions.json'))).toBe(true);
	});
});
