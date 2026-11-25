import { Command } from 'commander';
import { constructSignalShell, ensureSudo, loadEnvironment, renderError } from '@/cli/util';
import { getLogger } from '@/cli/logger';
import { cd, path, Shell, syncProcessCwd } from 'zx';
import { InstallProgress, InstallAction, skipActionIfAborted } from '@/cli/components/install-progress';
import { confirm } from '@/cli/components/confirm';
import { render, Static, Text } from 'ink';
import React from 'react';
import { Container } from '@/cli/components/container';

// Legacy RatOS-configurator deployment branches ("-deployment" suffix) used a different repository
// layout. The monorepo is installed from GitHub releases instead, so those branches can't be used here.
const isDeploymentBranch = (branch: string) => branch.indexOf('-deployment') > -1;

const renderBranchInfo = async ($: Shell) => {
	render(
		<Container>
			<Text bold>Current branch:</Text>
			<Text color="green">{await $`git branch --show-current`.text()}</Text>
			<Text bold>Available upstream branches:</Text>
			<Text>
				{(await $`git branch -r`)
					.lines()
					.map((line) => line.trim())
					.join('\n')}
			</Text>
		</Container>,
	);
};

const development = (program: Command) => {
	const development = program.command('development').description('Development commands');
	development
		.command('branch')
		.description('Switch the RatOS source checkout to another branch.')
		.argument('[remote]', 'The remote to fetch from, eg. "origin" or "upstream"')
		.argument('[branch]', 'The new branch to switch to, eg. "main" or "development"')
		.option('-f, --force', 'Forcefully delete and recreate the local branch if it already exists')
		.action(async (remote?: string, newBranch?: string | null, options?: { force?: boolean }) => {
			const { cmdSignal, $ } = constructSignalShell();
			syncProcessCwd();

			// Release installs are extracted archives, not git checkouts.
			let workspaceRoot: string;
			try {
				workspaceRoot = (await $`git rev-parse --show-toplevel`).text().trim();
			} catch (e) {
				renderError(
					'This RatOS installation is not a git checkout (it was installed from a release), so branches cannot be switched.',
				);
				return;
			}
			// Run all git commands against the whole repository, not just the configurator package.
			cd(workspaceRoot);

			if (remote == null) {
				await renderBranchInfo($);
				return;
			}
			if (newBranch == null) {
				newBranch = remote;
				remote = 'origin';
			}
			try {
				if ((await $`git remote get-url ${remote}`).text().trim() === '') {
					renderError(`Remote "${remote}" not found`);
				}
			} catch (e) {
				renderError(`Remote "${remote}" not found`);
			}
			if (
				(await $`git fetch ${remote} --depth=1 && git branch -r`)
					.lines()
					.map((line) => line.trim())
					.filter((line) => line.startsWith(`${remote}/${newBranch}`)).length === 0
			) {
				renderError(`Branch "${newBranch}" not found on remote "${remote}"`);
			}
			if (isDeploymentBranch(newBranch)) {
				renderError(
					`"${newBranch}" is a legacy deployment branch. RatOS is now distributed as GitHub releases, deployment branches are no longer supported.`,
				);
			}
			await ensureSudo();

			const currentBranch = (await $`git branch --show-current`).lines()[0];
			const hasDirtyWorkingDirectory =
				(await $`git status --porcelain`).lines().filter((line) => line.trim() !== '').length > 0;

			getLogger().info(
				{
					currentBranch,
					hasDirtyWorkingDirectory,
				},
				`Switching from ${currentBranch} to ${newBranch}...`,
			);

			// Prompt if new branch exists locally
			if (
				(await $`git branch -a`).lines().filter((line) => line.trim() === newBranch).length !== 0 &&
				!options?.force
			) {
				if (
					!(await confirm(
						`Local branch "${newBranch}" will be recreated, proceed?`,
						`If you proceed "${newBranch}" will be forcefully deleted and recreated to match "${remote}/${newBranch}". ` +
							'This will also delete any unpushed local changes you have made to the branch.',
						false,
					))
				) {
					getLogger().info(
						`Aborting switch to ${newBranch}, local branch already exists and user did not confirm the recreation`,
					);
					renderError(`Aborted branch switch to ${newBranch}.`);
					return;
				}
			}

			if (
				hasDirtyWorkingDirectory &&
				!(await confirm(
					'Working directory is dirty and will be forcefully reset, do you want to continue?',
					(await $`git diff --name-only HEAD`)
						.lines()
						.map((line) => 'Would remove ' + path.relative(process.cwd(), line.trim()))
						.join('\n') +
						'\n' +
						(await $`git clean -d -n`)
							.lines()
							.map((line) => line.trim())
							.join('\n'),
					false,
				))
			) {
				getLogger().info(
					`Aborting switch to ${newBranch}, working directory is dirty and user did not confirm the reset`,
				);
				renderError('Branch switching aborted because the working directory is dirty.');
				return;
			}

			getLogger().info(`Switching from ${currentBranch} to ${newBranch}...`);

			const installActions: (InstallAction | null)[] = [
				hasDirtyWorkingDirectory
					? {
							name: 'Resetting working directory',
							execute: skipActionIfAborted(async (abortSignal, helpers) => {
								await $`git reset --hard HEAD`;
								await $`git clean -d -f`;
								return { newName: 'Reset working directory', stepStatus: 'success' };
							}),
						}
					: null,
				{
					name: 'Fetching latest changes',
					execute: skipActionIfAborted(async (abortSignal, helpers) => {
						await $`git fetch ${remote} ${newBranch}`;
						return { newName: 'Fetched latest changes', stepStatus: 'success' };
					}),
				},
				{
					name: `Switching to ${newBranch}...`,
					execute: async (abortSignal, helpers) => {
						await $({ signal: abortSignal })`git switch -C ${newBranch} ${remote}/${newBranch}`;
						if (abortSignal.aborted) {
							await $`git checkout ${currentBranch}`;
							return { newName: 'Aborted branch switch', stepStatus: 'error' };
						}
						getLogger().info(`Switched to branch "${newBranch}"`);
						// Every branch shares the monorepo layout, so .env.local and the configured paths stay valid.
						// update.sh (next step) installs dependencies and rebuilds the CLI for the new branch.
						return { newName: 'Switched branch to ' + newBranch, stepStatus: 'success' };
					},
				},
				{
					name: 'Updating RatOS configurator',
					execute: skipActionIfAborted(async (abortSignal, helpers) => {
						await $({ signal: abortSignal })`sudo ${loadEnvironment().RATOS_SCRIPT_DIR}/update.sh`;
						return { newName: 'Updated RatOS configurator', stepStatus: 'success' };
					}),
				},
				{
					name: 'Restarting RatOS configurator',
					execute: skipActionIfAborted(async (abortSignal, helpers) => {
						let isDisabled = false;
						try {
							isDisabled = (await $`sudo systemctl is-enabled ratos-configurator`).text().trim() === 'disabled';
						} catch (e) {
							isDisabled = true;
						}
						if (isDisabled) {
							return {
								newName: 'Skipped restarting RatOS configurator (service disabled)',
								stepStatus: 'skipped',
							};
						}
						await $({ signal: abortSignal })`sudo systemctl restart ratos-configurator`;
						await $({
							signal: abortSignal,
						})`sleep 1 && curl -s -o /dev/null --retry 20 --retry-all-errors --retry-delay 1 --retry-max-time 60 "http://localhost:3000/configure" &> /dev/null`;
						return { newName: 'Restarted RatOS configurator', stepStatus: 'success' };
					}),
				},
				{
					name: 'Updating RatOS configuration',
					execute: skipActionIfAborted(async (abortSignal, helpers) => {
						await $({
							signal: abortSignal,
						})`sudo ${loadEnvironment().RATOS_CONFIGURATION_PATH}/scripts/ratos-update.sh`;
						return { newName: 'Updated RatOS configuration', stepStatus: 'success' };
					}),
				},
				{
					name: 'Restarting Klipper',
					execute: skipActionIfAborted(async (abortSignal, helpers) => {
						await $({ signal: abortSignal })`sudo systemctl restart klipper`;
						return { newName: 'Restarted Klipper', stepStatus: 'success' };
					}),
				},
				{
					name: 'Restarting Moonraker',
					execute: skipActionIfAborted(async (abortSignal, helpers) => {
						await $({ signal: abortSignal })`sudo systemctl restart moonraker`;
						return { newName: 'Restarted Moonraker', stepStatus: 'success' };
					}),
				},
			];

			render(
				<InstallProgress
					initialStatusText={`Switching branch to ${newBranch}...`}
					cmdSignal={cmdSignal}
					steps={installActions.filter(Boolean)}
				/>,
			);
		});
};

export default development;
