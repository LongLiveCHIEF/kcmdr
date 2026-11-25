#!/usr/bin/env bash
#
# Assemble a ready-to-run RatOS configurator release from prebuilt monorepo output.
#
# Printers never install anything: the release carries the configurator's runtime dependencies,
# and the RatOS image and Moonraker's `type: zip` updater only extract it. Moonraker extracts with
# Python's zipfile, which can't create symlinks, so the release must not contain any.
#
# Layout (paths match the monorepo, so the configurator's scripts work unchanged):
#   release_info.json
#   packages/configurator/{package.json,next.config.mjs,.env,public,dist,configuration,src/scripts,node_modules}
#   packages/cli/{package.json,bin,dist}
#
# The server runs with `node node_modules/next/dist/bin/next start` from packages/configurator,
# the CLI with packages/cli/bin/ratos (its bundle needs no node_modules).
#
# Usage: run through nx so both projects are built first:
#   pnpm nx run ratos-configurator:package
#
# Environment:
#   RELEASE_VERSION  Version/tag recorded in release_info.json; must equal the GitHub release tag for
#                    Moonraker's update check (default: the workspace VERSION file, else the
#                    configurator's package version)
#   RELEASE_REPO     GitHub "owner/name" recorded in release_info.json (default: $GITHUB_REPOSITORY,
#                    then the origin remote)
#
# Output (in <workspace>/dist/release):
#   ratos-configurator/          staged release tree
#   ratos-configurator.tar.gz    archive (manual installs)
#   ratos-configurator.zip       archive in the layout Moonraker's `type: zip` updater expects

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
WORKSPACE_DIR=$(cd "$APP_DIR/../.." && pwd)
CLI_DIR="$WORKSPACE_DIR/packages/cli"

RELEASE_NAME="ratos-configurator"
OUT_DIR="$WORKSPACE_DIR/dist/release"
STAGE_DIR="$OUT_DIR/$RELEASE_NAME"
DEPLOY_DIR="$OUT_DIR/.deploy"

fail() {
	echo "Error: $1" >&2
	exit 1
}

[ -f "$APP_DIR/dist/BUILD_ID" ] || fail "configurator build output missing, run: pnpm nx run ratos-configurator:build"
[ -f "$CLI_DIR/dist/ratos.mjs" ] || fail "CLI build output missing, run: pnpm nx run ratos-cli:build"

if [ -n "${RELEASE_VERSION:-}" ]; then
	VERSION="$RELEASE_VERSION"
elif [ -f "$WORKSPACE_DIR/VERSION" ]; then
	VERSION=$(tr -d '[:space:]' < "$WORKSPACE_DIR/VERSION")
else
	VERSION=$(node -p "require('$APP_DIR/package.json').version")
fi

REPO="${RELEASE_REPO:-${GITHUB_REPOSITORY:-}}"
if [ -z "$REPO" ]; then
	origin_url=$(git -C "$WORKSPACE_DIR" remote get-url origin 2>/dev/null || true)
	# git@github.com:owner/name.git or https://github.com/owner/name(.git)
	REPO=$(echo "$origin_url" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
fi
[ -n "$REPO" ] || REPO="unknown/unknown"

echo "Packaging $RELEASE_NAME $VERSION ($REPO)"

rm -rf "$STAGE_DIR" "$DEPLOY_DIR" "$OUT_DIR/$RELEASE_NAME.tar.gz" "$OUT_DIR/$RELEASE_NAME.zip"
mkdir -p "$STAGE_DIR/packages/configurator/src" "$STAGE_DIR/packages/cli"

# Configurator: Next.js server (`next start` reads next.config.mjs, .env, public/ and dist/),
# the RatOS configuration, and the helper scripts it runs (flashing, wifi, hostname, ...).
rsync -a \
	"$APP_DIR/package.json" \
	"$APP_DIR/next.config.mjs" \
	"$APP_DIR/.env" \
	"$APP_DIR/public" \
	"$APP_DIR/configuration" \
	"$STAGE_DIR/packages/configurator/"
rsync -a --exclude cache "$APP_DIR/dist" "$STAGE_DIR/packages/configurator/"
# `ratos --version` reports the configurator package's version; make it the release version.
node -e '
const fs = require("fs");
const [file, version] = process.argv.slice(1);
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.version = version.replace(/^v/, "");
fs.writeFileSync(file, JSON.stringify(pkg, null, "\t") + "\n");
' "$STAGE_DIR/packages/configurator/package.json" "$VERSION"
rsync -a "$APP_DIR/src/scripts" "$STAGE_DIR/packages/configurator/src/"

# Runtime dependencies as a flat (hoisted) node_modules without symlinks, including the Linux ARM
# variants of platform-specific packages. Next's SWC compiler is only needed by `next build`.
pnpm --dir "$WORKSPACE_DIR" --filter ratos-configurator deploy --prod \
	--config.node-linker=hoisted --os=linux --cpu=arm --cpu=arm64 --cpu=x64 \
	"$DEPLOY_DIR"
rsync -a --exclude .bin --exclude '@next/swc-*' "$DEPLOY_DIR/node_modules" "$STAGE_DIR/packages/configurator/"
rm -rf "$DEPLOY_DIR"

# CLI: self-contained bundle and the `ratos` wrapper.
rsync -a "$CLI_DIR/package.json" "$CLI_DIR/bin" "$CLI_DIR/dist" "$STAGE_DIR/packages/cli/"

symlinks=$(find "$STAGE_DIR" -type l)
[ -z "$symlinks" ] || fail "release contains symlinks, which Moonraker can't extract:
$symlinks"

# Version file read by Moonraker's `type: zip` updater and by the configurator (release installs
# have no .git).
cat > "$STAGE_DIR/release_info.json" <<EOF
{
	"project_name": "${REPO#*/}",
	"project_owner": "${REPO%%/*}",
	"version": "$VERSION",
	"asset_name": "$RELEASE_NAME.zip"
}
EOF

tar -C "$STAGE_DIR" -czf "$OUT_DIR/$RELEASE_NAME.tar.gz" .
# zip with the release contents at the archive root, as Moonraker extracts it into the install path.
(
	cd "$STAGE_DIR"
	mapfile -t entries < <(ls -A)
	python3 -m zipfile -c "$OUT_DIR/$RELEASE_NAME.zip" "${entries[@]}"
)

echo "Release written to $OUT_DIR:"
ls -lh "$OUT_DIR"
du -sh "$STAGE_DIR"
