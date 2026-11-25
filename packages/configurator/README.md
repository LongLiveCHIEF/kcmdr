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

### Releases and the RatOS image

RatOS is released from the workspace root with the `Release` workflow (`.github/workflows/release-os.yml`, started manually with a version such as `3.1.0`; suffixed versions like `3.1.0-beta.1` are tagged the same way). One GitHub release, tagged with that version, contains:

* the RatOS images for every board in `config.yml`, built on MainsailOS with Kalico, Moonraker, Mainsail and the configurator
* `ratos-configurator.zip` and `ratos-configurator.tar.gz`, the prebuilt configurator that the images install and that Moonraker updates from

The configurator release is ready to run. It carries its runtime dependencies (a flat `node_modules` without symlinks), so printers never run a package manager:

```
release_info.json
packages/configurator/{package.json,next.config.mjs,.env,public,dist,configuration,src/scripts,node_modules}
packages/cli/{package.json,bin,dist}
```

To build it locally, run the following. The output goes to `dist/release` at the workspace root:

```bash
pnpm nx run ratos-configurator:package
```

The image module `modules/generic/70-ratos` installs it to `~/ratos-configurator`: service, sudoers whitelist, udev rules, logrotate, the `ratos` command, and the RatOS configuration (`ratos-install.sh` / `ratos-post-install.sh`).

#### Updates and settings

Moonraker updates the configurator through the `type: zip` entry for `ratos-configurator` in `configuration/moonraker.conf`. It replaces `~/ratos-configurator` with the newest release's `ratos-configurator.zip` and restarts the service; nothing else runs on the printer. Kalico, Moonraker, Mainsail and the rest are updated by their own Moonraker entries. `configuration/scripts/ratos-update.sh` is no longer run automatically (`ratos doctor` still runs it).

Per-printer settings live in `~/printer_data/systemd/ratos-configurator.env`, next to `klipper.env` and `moonraker.env`. The service loads it as its `EnvironmentFile`, and the server and `ratos` CLI read it through `RATOS_ENV_FILE`, so its values override the defaults in the package's `.env`. MainsailOS rewrites it, along with the RatOS service, sudoers entries and links, when the user is renamed in Raspberry Pi Imager.

## Help and support

Please use the unofficial Rat Rig discord for help and support. Only create an issue if you have found a bug and can describe how to reproduce it, feature requests and discussions should happen in the #ratos-development channel on discord.

<a href="http://discord.gg/ratrig" target="_blank" rel="noopener noreferrer" style="margin-left: 5px;"><img src="https://img.shields.io/discord/582187371529764864?color=%235865F2&amp;label=discord&amp;logo=discord&amp;logoColor=white&amp;style=flat" alt="discord"></a>
