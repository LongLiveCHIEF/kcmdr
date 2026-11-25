# RatOS Configurator

**Note: for instructions on the Kalico migration, see [migration-to-kalico](migration-to-kalico.md)**

This is the repository for the [RatOS](os.ratrig.com) configurator - a 3d printer provisioning application for RatOS with config generation, board identification, provisioning and automatic flashing. 

## Contributing

All non-hotfix pull requests (meaning additions, enhancements and features) should be submitted against the `development` branch.
Bug fixes should be submitted against the v2.x branch and subseqently merged into `development`.

## Local setup

The configurator lives in the kcmdr monorepo alongside the RatOS CLI:

* `packages/configurator` – the Next.js configurator (`ratos-configurator`), its RatOS `configuration/` and the Pi-side scripts in `src/scripts/`
* `packages/cli` – the `ratos` command line tool (`ratos-cli`)

See the [workspace contributing guide](../../CONTRIBUTING.md) for installing the toolchain (mise, node, pnpm).

### Requirements

* Linux or WSL
* Node and pnpm in the versions pinned by the workspace `mise.toml`

Most bash scripts will assume user `pi` exists. Needs fixing, fortunately you don't need them for most work.

### Installation

Install dependencies from the workspace root:

```bash
pnpm install
```

Generate `packages/configurator/.env.local` and a local `printer_data` layout under `<workspace>/dev`:

```bash
packages/configurator/scripts/setup-local-dev.sh <klipper-host>.local
```

The script links `configuration/` into `dev/printer_data/config/RatOS`. Klipper and Moonraker default to `dev/klipper` and `dev/moonraker`. To use existing checkouts, set `KLIPPER_DIR`, `KLIPPER_ENV` and `MOONRAKER_DIR` when you run it. Some tests read `.env.test.local` first, so copy the file if needed:

```bash
cp packages/configurator/.env.local packages/configurator/.env.test.local
```

The `NEXT_PUBLIC_KLIPPER_HOSTNAME` variable is used by the frontend to connect to moonraker and klipper, those need to be real. The RatOS configurator will save configuration to the database on the moonraker instance running on that host. Add the browser origin (e.g. `http://localhost:3000`) to that Moonraker's `cors_domains`.

### (Optional) link the RatOS cli binary (commands only work when dev server is running)

```bash
pnpm nx run ratos-cli:build
sudo ln -s "$PWD/packages/cli/bin/ratos" "/usr/local/bin/ratos"
```

### Developing

Run tasks with nx from the workspace root:

* `pnpm nx run ratos-configurator:dev` to run the development server
* `pnpm nx run-many -t test -p ratos-configurator ratos-cli` to run the tests
* `pnpm nx run-many -t typecheck -p ratos-configurator ratos-cli` to run typechecking
* `pnpm nx run-many -t lint -p ratos-configurator ratos-cli` to run linting
* `pnpm nx run ratos-configurator:build` to build the configurator into `packages/configurator/dist`
* `pnpm nx run ratos-cli:build` to build the CLI into `packages/cli/dist`

### Releases

Releases are published as GitHub releases by the `Release` workflow when a `v*` tag is pushed. Tags with a suffix, such as `v2.2.0-beta.1`, become pre-releases. Each release has two archives with the same contents: `ratos-configurator.tar.gz`, which keeps file modes, and `ratos-configurator.zip`. They contain the runtime subset of the monorepo:

```
release_info.json  package.json  pnpm-workspace.yaml  pnpm-lock.yaml
packages/configurator/{package.json,next.config.mjs,.env,public,dist,configuration,scripts,src/scripts}
packages/cli/{package.json,bin,dist}
```

To build a release locally, run the following. The output goes to `dist/release` at the workspace root:

```bash
RELEASE_VERSION=v2.1.0 pnpm nx run ratos-configurator:package
```

To install a release, extract it to `~/ratos-configurator`, then run `packages/configurator/src/scripts/setup.sh`. The scripts detect a release install from `release_info.json` and install only production dependencies (`pnpm install --frozen-lockfile --prod`). In a source checkout they install everything and build the CLI.

#### Updates

Moonraker updates release installs through the `type: zip` entry for `ratos-configurator` in `configuration/moonraker.conf`. It replaces `~/ratos-configurator` with the new release's `ratos-configurator.zip` and restarts the `ratos-configurator` service. The service then finishes the install with `src/scripts/release-update.sh`:

* `ExecStartPre` runs `update.sh` (dependencies, CLI link, udev rules, sudoers, service file) once per release.
* `ExecStartPost` queues `configuration/scripts/ratos-update.sh` in a transient unit once per release. It runs after the configurator answers, because it registers Klipper extensions through it.

Moonraker wipes the install folder on update and keeps only the top-level `persistent_files`. Put a printer's configurator overrides in `~/ratos-configurator/.env.local`; the scripts link it to `packages/configurator/.env.local`. An existing `packages/configurator/.env.local` is moved there automatically.

Source checkouts still update through the git `post-merge` hook, and Moonraker reports them as invalid `zip` installs.

## Help and support

Please use the unofficial Rat Rig discord for help and support. Only create an issue if you have found a bug and can describe how to reproduce it, feature requests and discussions should happen in the #ratos-development channel on discord.

<a href="http://discord.gg/ratrig" target="_blank" rel="noopener noreferrer" style="margin-left: 5px;"><img src="https://img.shields.io/discord/582187371529764864?color=%235865F2&amp;label=discord&amp;logo=discord&amp;logoColor=white&amp;style=flat" alt="discord"></a>
