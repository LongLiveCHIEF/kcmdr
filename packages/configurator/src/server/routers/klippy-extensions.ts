import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { getLogger } from '@/server/helpers/logger';
import { publicProcedure, router } from '@/server/trpc';
import path from 'path';
import { serverSchema } from '@/env/schema.mjs';
import { symlinkExtensions, unlinkExtension } from '@/server/helpers/extensions';

const klippyExtension = z.object({
	fileName: z.string(),
	path: z.string(),
	extensionName: z.string(),
	errorIfExists: z.boolean().optional(),
	errorIfNotExists: z.boolean().optional(),
	isKinematics: z.boolean().optional(),
});
const klippyExtensions = z.array(klippyExtension);

export type KlippyExtension = z.infer<typeof klippyExtension>;

export const getKlippyExtensions = () => {
	const environment = serverSchema.parse(process.env);
	const extensionDir = environment.RATOS_DATA_DIR;
	const klippyExtensionsFile = path.join(extensionDir, 'klippy-extensions.json');
	if (!existsSync(extensionDir)) {
		mkdirSync(extensionDir);
	}
	if (!existsSync(klippyExtensionsFile)) {
		writeFileSync(klippyExtensionsFile, '[]');
	}
	const currentExtensions = klippyExtensions.parse(JSON.parse(readFileSync(klippyExtensionsFile).toString()));
	return currentExtensions;
};

const saveExtensions = (extensions: z.infer<typeof klippyExtensions>) => {
	const environment = serverSchema.parse(process.env);
	const extensionDir = environment.RATOS_DATA_DIR;
	const klippyExtensionsFile = path.join(extensionDir, 'klippy-extensions.json');
	if (!existsSync(extensionDir)) {
		mkdirSync(extensionDir);
	}
	writeFileSync(klippyExtensionsFile, JSON.stringify(extensions));
};

export const symlinkKlippyExtensions = async (errorIfExists?: boolean) => {
	const environment = serverSchema.parse(process.env);
	const currentExtensions = getKlippyExtensions();
	return await symlinkExtensions({
		extensions: currentExtensions,
		options: {
			errorIfExists: errorIfExists,
		},
		gitRepoPath: environment.KLIPPER_DIR,
		relativePath,
		saveExtensions,
	});
};

const relativePath = (ext: z.infer<typeof klippyExtension>) => {
	return ext.isKinematics ? `klippy/kinematics` : `klippy/extras`;
};

/** Registers a Klipper extension. Returns false when one with the same name or file is already registered. */
export const registerKlippyExtension = (extension: KlippyExtension) => {
	const currentExtensions = getKlippyExtensions();
	const { path: filePath, fileName, errorIfExists, extensionName } = extension;
	const extensionPath = path.join(filePath, fileName);
	if (!existsSync(extensionPath)) {
		throw new TRPCError({
			message: `File "${extensionPath}" does not exist`,
			code: 'PRECONDITION_FAILED',
		});
	}
	if (
		currentExtensions.find(
			(ext) =>
				ext.extensionName === extensionName ||
				(ext.fileName === fileName && !!ext.isKinematics === !!extension.isKinematics),
		)
	) {
		if (errorIfExists === true) {
			throw new TRPCError({
				message: `${
					extension.isKinematics ? 'A kinematic' : 'An'
				} extension called "${extensionName}" with fileName "${fileName}" is already registered`,
				code: 'PRECONDITION_FAILED',
			});
		}
		getLogger().warn(
			`${
				extension.isKinematics ? 'A kinematic' : 'An'
			} extension called "${extensionName}" with the fileName "${fileName}" is already registered, ignoring...`,
		);
		return false;
	}
	currentExtensions.push(extension);
	saveExtensions(currentExtensions);
	return true;
};

/** Unlinks and unregisters a Klipper extension. */
export const unregisterKlippyExtension = async (extensionName: string, errorIfNotExists?: boolean) => {
	const currentExtensions = getKlippyExtensions();
	const extensionIndex = currentExtensions.findIndex((ext) => ext.extensionName === extensionName);
	if (extensionIndex === -1) {
		if (errorIfNotExists === true) {
			throw new TRPCError({
				message: `Extension with the name "${extensionName}" is not registered`,
				code: 'PRECONDITION_FAILED',
			});
		}
		getLogger().warn(`Extension with the name "${extensionName}" is not registered, ignoring...`);
		return {
			result: 'success' as const,
			message: `Extension "${extensionName}" does not exist. Nothing to do.`,
		};
	}
	const ext = currentExtensions.splice(extensionIndex, 1);
	if (ext.length !== 1) {
		throw new Error('Failed to remove extension');
	}
	const res = await unlinkExtension({
		extension: ext[0],
		gitRepoPath: serverSchema.parse(process.env).KLIPPER_DIR,
		relativePath,
	});
	if (res.result === 'success') {
		saveExtensions(currentExtensions);
	}
	return res;
};

export const klippyExtensionsRouter = router({
	register: publicProcedure.input(z.object({ json: klippyExtension })).mutation(async ({ input }) => {
		registerKlippyExtension(input.json);
		return true;
	}),
	unregister: publicProcedure
		.input(z.object({ extensionName: z.string(), errorIfNotExists: z.boolean().optional() }))
		.mutation(async ({ input }) => await unregisterKlippyExtension(input.extensionName, input.errorIfNotExists)),
	symlink: publicProcedure
		.input(
			z.object({
				errorIfExists: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => await symlinkKlippyExtensions(input.errorIfExists)),
	unlink: publicProcedure.mutation(async () => {
		const currentExtensions = getKlippyExtensions();
		return await Promise.all(
			currentExtensions.map(async (ext) => {
				const res = await unlinkExtension({
					extension: ext,
					gitRepoPath: serverSchema.parse(process.env).KLIPPER_DIR,
					relativePath,
				});
				return res;
			}),
		);
	}),
	list: publicProcedure.output(klippyExtensions).query(async () => {
		return getKlippyExtensions();
	}),
});
