import { exec } from 'child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * Path of release_info.json for installs extracted from a GitHub release.
 * RATOS_SCRIPT_DIR is <workspace>/packages/configurator/src/scripts, and the file sits at <workspace>.
 */
export function getReleaseInfoPath(): string | null {
	const scriptDir = process.env.RATOS_SCRIPT_DIR;
	return scriptDir ? path.resolve(scriptDir, '../../../../release_info.json') : null;
}

/** The version recorded in release_info.json, or null when this is not a release install. */
export async function getReleaseVersion(): Promise<string | null> {
	const releaseInfoPath = getReleaseInfoPath();
	if (releaseInfoPath == null || !existsSync(releaseInfoPath)) {
		return null;
	}
	const releaseInfo = JSON.parse(await readFile(releaseInfoPath, 'utf-8'));
	return typeof releaseInfo?.version === 'string' ? releaseInfo.version : null;
}

/**
 * The installed RatOS configurator version.
 *
 * Release installs have no git checkout, so the version recorded in their release_info.json is used.
 * Source checkouts report `git describe --tags --always`, run in `gitCwd`.
 */
export async function getInstalledConfiguratorVersion(gitCwd: string | undefined): Promise<GitVersion> {
	const releaseVersion = await getReleaseVersion();
	if (releaseVersion != null) {
		return releaseVersion as GitVersion;
	}
	const { stdout } = await promisify(exec)('git describe --tags --always', { cwd: gitCwd });
	return stdout.trim() as GitVersion;
}
