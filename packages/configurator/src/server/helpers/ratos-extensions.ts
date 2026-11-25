import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { serverSchema } from '@/env/schema.mjs';
import {
	getKlippyExtensions,
	registerKlippyExtension,
	unregisterKlippyExtension,
} from '@/server/routers/klippy-extensions';
import {
	getMoonrakerExtensions,
	registerMoonrakerExtension,
	unregisterMoonrakerExtension,
} from '@/server/routers/moonraker-extensions';

type Environment = ReturnType<typeof serverSchema.parse>;

interface ExpectedExtension {
	/** Absolute path of the extension's python file. */
	file: string;
	/** Linked into klippy/kinematics instead of klippy/extras. */
	isKinematics?: boolean;
}

// Registered names are the configurator's existing (snake_case) extension names.

/** Klipper extensions shipped in the RatOS configuration's klippy/ folder: [registered name, file]. */
const RATOS_KLIPPY_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
	['gcode_shell_extension', 'gcode_shell_command.py'],
	['ratos_homing_extension', 'ratos_homing.py'],
	['linear_movement_analysis', 'linear_movement_vibrations.py'],
	['z_offset_probe_extension', 'z_offset_probe.py'],
	['resonance_generator_extension', 'resonance_generator.py'],
	['ratos_extension', 'ratos.py'],
	['beacon_mesh_extension', 'beacon_mesh.py'],
	['beacon_true_zero_correction_extension', 'beacon_true_zero_correction.py'],
	['beacon_adaptive_heatsoak_extension', 'beacon_adaptive_heat_soak.py'],
	['fastconfig', 'fastconfig.py'],
	['named_offsets', 'named_offsets.py'],
	['beacon_user_z_offset', 'beacon_user_z_offset.py'],
	['ratos_dual_carriage_extras', 'ratos_dual_carriage_extras.py'],
];

/**
 * Klipper extensions that RatOS no longer uses: [registered name, path relative to KLIPPER_DIR].
 * Any that are still registered get unregistered, and their paths are left as the Klipper
 * repository has them.
 */
const RETIRED_KLIPPY_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
	// Replaced by Kalico's hybrid_corexy kinematics with invert_kinematics: True
	['ratos_hybrid_corexy', 'klippy/kinematics/ratos_hybrid_corexy.py'],
];

/** Kalico ships its own gcode_shell_command module, which takes the same options as RatOS's copy. */
const GCODE_SHELL_EXTENSION = 'gcode_shell_extension';
const GCODE_SHELL_MODULE = 'klippy/extras/gcode_shell_command.py';

const execFileAsync = promisify(execFile);

const resolvePath = (file: string) => (existsSync(file) ? realpathSync(file) : path.resolve(file));

/** Beacon is installed next to Klipper (~/beacon) unless BEACON_DIR says otherwise. */
const beaconDir = (environment: Environment) =>
	process.env.BEACON_DIR || path.join(path.dirname(environment.KLIPPER_DIR), 'beacon');

export const expectedKlippyExtensions = (environment: Environment) => {
	const klippyDir = path.join(environment.RATOS_CONFIGURATION_PATH, 'klippy');
	const expected = new Map<string, ExpectedExtension>();
	expected.set('beacon', { file: resolvePath(path.join(beaconDir(environment), 'beacon.py')) });
	for (const [name, fileName] of RATOS_KLIPPY_EXTENSIONS) {
		expected.set(name, { file: resolvePath(path.join(klippyDir, fileName)) });
	}
	return expected;
};

/** moonraker-timelapse is installed next to Moonraker (~/moonraker-timelapse). */
export const expectedMoonrakerExtensions = (environment: Environment) => {
	const expected = new Map<string, ExpectedExtension>();
	const timelapseDir = path.join(path.dirname(environment.MOONRAKER_DIR), 'moonraker-timelapse');
	expected.set('timelapse', { file: resolvePath(path.join(timelapseDir, 'component', 'timelapse.py')) });
	return expected;
};

const git = (repo: string, ...args: string[]) => execFileAsync('git', ['-C', repo, ...args]);

/** Whether the Klipper repository provides the module at `modulePath` (relative to KLIPPER_DIR) itself. */
export const klipperShipsModule = async (klipperDir: string, modulePath: string) => {
	try {
		await git(klipperDir, 'ls-files', '--error-unmatch', '--', modulePath);
		return true;
	} catch {
		return false;
	}
};

/** Leaves the path of a retired extension as the Klipper repository has it. */
const cleanUpRetiredModule = async (klipperDir: string, modulePath: string, report: string[]) => {
	const file = path.join(klipperDir, modulePath);
	if (await klipperShipsModule(klipperDir, modulePath)) {
		try {
			await git(klipperDir, 'diff', '--quiet', '--', modulePath);
		} catch {
			report.push(`Restoring ${modulePath} from the Klipper repository.`);
			await git(klipperDir, 'checkout', '--', modulePath);
		}
		return;
	}
	const stat = await lstat(file).catch(() => null);
	if (stat?.isSymbolicLink() && !existsSync(file)) {
		report.push(`Removing dangling symlink ${modulePath}.`);
		await rm(file, { force: true });
	}
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Makes sure the Klipper and Moonraker extensions RatOS needs are registered with the configurator,
 * with the files this installation provides, and that retired ones are not. Runs when the server
 * starts, before the registered extensions are linked into Klipper and Moonraker, so a new release
 * that adds, moves or retires an extension takes effect on its first start.
 *
 * Extensions registered by third parties are reported and left alone.
 *
 * @returns a report of what was checked and changed
 */
export const ensureRatosExtensions = async (): Promise<string[]> => {
	const environment = serverSchema.parse(process.env);
	const report: string[] = [];

	const expectedKlippy = expectedKlippyExtensions(environment);
	const retiredKlippy = new Map<string, string>(RETIRED_KLIPPY_EXTENSIONS);
	// Only use RatOS's gcode_shell_command when the Klipper repository doesn't provide one.
	if (await klipperShipsModule(environment.KLIPPER_DIR, GCODE_SHELL_MODULE)) {
		expectedKlippy.delete(GCODE_SHELL_EXTENSION);
		retiredKlippy.set(GCODE_SHELL_EXTENSION, GCODE_SHELL_MODULE);
	}

	const registerKlippy = (name: string, expected: ExpectedExtension) => {
		try {
			registerKlippyExtension({
				extensionName: name,
				path: path.dirname(expected.file),
				fileName: path.basename(expected.file),
				isKinematics: expected.isKinematics,
			});
			report.push(`Registered Klipper extension ${name} (${expected.file}).`);
		} catch (e) {
			report.push(`WARNING: Could not register Klipper extension ${name}: ${errorMessage(e)}`);
		}
	};

	const foundKlippy = new Set<string>();
	for (const ext of getKlippyExtensions()) {
		const name = ext.extensionName;
		const file = path.join(ext.path, ext.fileName);
		if (retiredKlippy.has(name)) {
			report.push(`Unregistering retired Klipper extension ${name}.`);
			await unregisterKlippyExtension(name);
			continue;
		}
		const expected = expectedKlippy.get(name);
		if (expected == null) {
			report.push(
				`WARNING: Unexpected Klipper extension ${name} (${file}), it may have been registered by a third party. ` +
					`To remove it, run 'ratos extensions unregister klipper ${name}'.`,
			);
			continue;
		}
		if (path.resolve(file) !== expected.file || !!ext.isKinematics !== !!expected.isKinematics) {
			report.push(`Klipper extension ${name} points at ${file} instead of ${expected.file}, re-registering.`);
			await unregisterKlippyExtension(name);
			continue;
		}
		if (!existsSync(file)) {
			report.push(`WARNING: Klipper extension ${name} file ${file} not found, unregistering.`);
			await unregisterKlippyExtension(name);
			continue;
		}
		foundKlippy.add(name);
	}

	for (const modulePath of retiredKlippy.values()) {
		try {
			await cleanUpRetiredModule(environment.KLIPPER_DIR, modulePath, report);
		} catch (e) {
			report.push(`WARNING: Could not clean up retired modulePath ${modulePath}: ${errorMessage(e)}`);
		}
	}

	for (const [name, expected] of expectedKlippy) {
		if (!foundKlippy.has(name)) {
			registerKlippy(name, expected);
		}
	}

	const expectedMoonraker = expectedMoonrakerExtensions(environment);
	const foundMoonraker = new Set<string>();
	for (const ext of getMoonrakerExtensions()) {
		const name = ext.extensionName;
		const file = path.join(ext.path, ext.fileName);
		const expected = expectedMoonraker.get(name);
		if (expected == null) {
			report.push(
				`WARNING: Unexpected Moonraker extension ${name} (${file}), it may have been registered by a third party. ` +
					`To remove it, run 'ratos extensions unregister moonraker ${name}'.`,
			);
			continue;
		}
		if (path.resolve(file) !== expected.file || !existsSync(file)) {
			report.push(`Moonraker extension ${name} points at ${file} instead of ${expected.file}, re-registering.`);
			await unregisterMoonrakerExtension(name);
			continue;
		}
		foundMoonraker.add(name);
	}
	for (const [name, expected] of expectedMoonraker) {
		if (foundMoonraker.has(name)) {
			continue;
		}
		try {
			registerMoonrakerExtension({
				extensionName: name,
				path: path.dirname(expected.file),
				fileName: path.basename(expected.file),
			});
			report.push(`Registered Moonraker extension ${name} (${expected.file}).`);
		} catch (e) {
			report.push(`WARNING: Could not register Moonraker extension ${name}: ${errorMessage(e)}`);
		}
	}

	if (report.length === 0) {
		report.push('All RatOS extensions are registered.');
	}
	return report;
};
