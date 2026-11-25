import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getLogger } from '@/server/helpers/logger';
import { publicProcedure, router } from '@/server/trpc';
import path from 'path';
import { serverSchema } from '@/env/schema.mjs';
import { symlinkExtensions, unlinkExtension } from '@/server/helpers/extensions';

const moonrakerExtension = z.object({
	fileName: z.string(),
	path: z.string(),
	extensionName: z.string(),
	errorIfExists: z.boolean().optional(),
});
const moonrakerExtensions = z.array(moonrakerExtension);

export type MoonrakerExtension = z.infer<typeof moonrakerExtension>;

export const getMoonrakerExtensions = () => {
	const environment = serverSchema.parse(process.env);
	const extensionDir = environment.RATOS_DATA_DIR;
	const moonrakerExtensionsFile = path.join(extensionDir, 'moonraker-extensions.json');
	if (!existsSync(extensionDir)) {
		mkdirSync(extensionDir);
	}
	if (!existsSync(moonrakerExtensionsFile)) {
		writeFileSync(moonrakerExtensionsFile, '[]');
	}
	const currentExtensions = moonrakerExtensions.parse(JSON.parse(readFileSync(moonrakerExtensionsFile).toString()));
	return currentExtensions;
};

const saveExtensions = (extensions: z.infer<typeof moonrakerExtensions>) => {
	const environment = serverSchema.parse(process.env);
	const extensionDir = environment.RATOS_DATA_DIR;
	const moonrakerExtensionsFile = path.join(extensionDir, 'moonraker-extensions.json');
	if (!existsSync(extensionDir)) {
		mkdirSync(extensionDir);
	}
	writeFileSync(moonrakerExtensionsFile, JSON.stringify(extensions));
};

export const symlinkMoonrakerExtensions = async (errorIfExists?: boolean) => {
	const environment = serverSchema.parse(process.env);
	const currentExtensions = getMoonrakerExtensions();

	return await symlinkExtensions({
		extensions: currentExtensions,
		options: {
			errorIfExists: errorIfExists,
		},
		gitRepoPath: environment.MOONRAKER_DIR,
		relativePath: () => `moonraker/components`,
		saveExtensions,
	});
};

/** Registers a Moonraker extension. Returns false when one with the same file is already registered. */
export const registerMoonrakerExtension = (extension: MoonrakerExtension) => {
	const currentExtensions = getMoonrakerExtensions();
	const { path: filePath, fileName, errorIfExists } = extension;
	const extensionPath = path.join(filePath, fileName);
	if (!existsSync(extensionPath)) {
		getLogger().error(`File "${extensionPath}" does not exist`);
		throw new TRPCError({
			message: `File "${extensionPath}" does not exist`,
			code: 'PRECONDITION_FAILED',
		});
	}
	if (currentExtensions.find((ext) => ext.fileName === fileName)) {
		if (errorIfExists === true) {
			getLogger().error(`An extension with the fileName "${fileName}" is already registered`);
			throw new TRPCError({
				message: `An extension with the fileName "${fileName}" is already registered`,
				code: 'PRECONDITION_FAILED',
			});
		}
		getLogger().warn(`An extension with the fileName "${fileName}" is already registered, ignoring...`);
		return false;
	}
	currentExtensions.push(extension);
	saveExtensions(currentExtensions);
	return true;
};

/** Unlinks and unregisters a Moonraker extension. */
export const unregisterMoonrakerExtension = async (extensionName: string, errorIfNotExists?: boolean) => {
	const environment = serverSchema.parse(process.env);
	const currentExtensions = getMoonrakerExtensions();
	const extensionIndex = currentExtensions.findIndex((ext) => ext.extensionName === extensionName);
	if (extensionIndex === -1) {
		if (errorIfNotExists === true) {
			throw new TRPCError({
				message: `Extension with the name "${extensionName}" is not registered`,
				code: 'PRECONDITION_FAILED',
			});
		}
		getLogger().warn(`Extension with the name "${extensionName}" is not registered, ignoring...`);
		return { result: 'success' as const, message: `Extension with the name "${extensionName}" is not registered` };
	}
	const ext = currentExtensions.splice(extensionIndex, 1);
	if (ext.length !== 1) {
		throw new Error('Failed to remove extension');
	}
	const res = await unlinkExtension({
		extension: ext[0],
		gitRepoPath: environment.MOONRAKER_DIR,
		relativePath: 'moonraker/components',
	});
	if (res.result === 'success') {
		saveExtensions(currentExtensions);
	}
	return res;
};

export const moonrakerExtensionsRouter = router({
	register: publicProcedure.input(z.object({ json: moonrakerExtension })).mutation(async ({ input }) => {
		registerMoonrakerExtension(input.json);
		return true;
	}),
	symlink: publicProcedure
		.input(
			z.object({
				errorIfExists: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => await symlinkMoonrakerExtensions(input.errorIfExists)),
	unlink: publicProcedure.mutation(async () => {
		const currentExtensions = getMoonrakerExtensions();
		const environment = serverSchema.parse(process.env);
		return await Promise.all(
			currentExtensions.map(async (ext) => {
				const res = await unlinkExtension({
					extension: ext,
					gitRepoPath: environment.MOONRAKER_DIR,
					relativePath: 'moonraker/components',
				});
				return res;
			}),
		);
	}),
	unregister: publicProcedure
		.input(z.object({ extensionName: z.string(), errorIfNotExists: z.boolean().optional() }))
		.mutation(async ({ input }) => await unregisterMoonrakerExtension(input.extensionName, input.errorIfNotExists)),
	list: publicProcedure.output(moonrakerExtensions).query(async () => {
		return getMoonrakerExtensions();
	}),
});
