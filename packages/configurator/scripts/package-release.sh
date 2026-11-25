#!/usr/bin/env bash
#
# Assemble a RatOS configurator release from prebuilt monorepo output.
#
# The release keeps the monorepo layout so the Pi-side scripts work the same way as in a
# source checkout, but only contains what is needed at runtime:
#
#   release_info.json, package.json, pnpm-workspace.yaml, pnpm-lock.yaml
#   packages/configurator/{package.json,next.config.mjs,.env,public,dist,configuration,scripts,src/scripts}
#   packages/cli/{package.json,bin,dist}
#
# After extracting, install runtime dependencies from the workspace root with
#   pnpm install --frozen-lockfile --prod
# which packages/configurator/src/scripts/setup.sh and update.sh do automatically.
#
# Usage: run through nx so both projects are built first:
#   pnpm nx run ratos-configurator:package
#
# Environment:
#   RELEASE_VERSION  Version/tag recorded in release_info.json (default: v<configurator package version>)
#   RELEASE_REPO     GitHub "owner/name" recorded in release_info.json (default: $GITHUB_REPOSITORY,
#                    then the origin remote)
#
# Output (in <workspace>/dist/release):
#   ratos-configurator/          staged release tree
#   ratos-configurator.tar.gz    archive preserving file modes (manual installs)
#   ratos-configurator.zip       archive in the layout Moonraker's `type: zip` updater expects

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
WORKSPACE_DIR=$(cd "$APP_DIR/../.." && pwd)
CLI_DIR="$WORKSPACE_DIR/packages/cli"

RELEASE_NAME="ratos-configurator"
OUT_DIR="$WORKSPACE_DIR/dist/release"
STAGE_DIR="$OUT_DIR/$RELEASE_NAME"

fail() {
	echo "Error: $1" >&2
	exit 1
}

[ -f "$APP_DIR/dist/BUILD_ID" ] || fail "configurator build output missing, run: pnpm nx run ratos-configurator:build"
[ -f "$CLI_DIR/dist/ratos.mjs" ] || fail "CLI build output missing, run: pnpm nx run ratos-cli:build"

VERSION="${RELEASE_VERSION:-v$(node -p "require('$APP_DIR/package.json').version")}"

REPO="${RELEASE_REPO:-${GITHUB_REPOSITORY:-}}"
if [ -z "$REPO" ]; then
	origin_url=$(git -C "$WORKSPACE_DIR" remote get-url origin 2>/dev/null || true)
	# git@github.com:owner/name.git or https://github.com/owner/name(.git)
	REPO=$(echo "$origin_url" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
fi
[ -n "$REPO" ] || REPO="unknown/unknown"

echo "Packaging $RELEASE_NAME $VERSION ($REPO)"

rm -rf "$STAGE_DIR" "$OUT_DIR/$RELEASE_NAME.tar.gz" "$OUT_DIR/$RELEASE_NAME.zip"
mkdir -p "$STAGE_DIR/packages/configurator/src" "$STAGE_DIR/packages/cli"

# Workspace root: enough for `pnpm install --frozen-lockfile --prod`.
cp "$WORKSPACE_DIR/package.json" "$WORKSPACE_DIR/pnpm-workspace.yaml" "$WORKSPACE_DIR/pnpm-lock.yaml" "$STAGE_DIR/"

# Configurator: Next.js server (`next start` reads next.config.mjs, .env, public/ and dist/),
# the RatOS configuration, and the Pi-side scripts.
rsync -a \
	"$APP_DIR/package.json" \
	"$APP_DIR/next.config.mjs" \
	"$APP_DIR/.env" \
	"$APP_DIR/public" \
	"$APP_DIR/configuration" \
	"$APP_DIR/scripts" \
	"$STAGE_DIR/packages/configurator/"
rsync -a --exclude cache "$APP_DIR/dist" "$STAGE_DIR/packages/configurator/"
rsync -a "$APP_DIR/src/scripts" "$STAGE_DIR/packages/configurator/src/"

# CLI: bundled output and the `ratos` wrapper.
rsync -a "$CLI_DIR/package.json" "$CLI_DIR/bin" "$CLI_DIR/dist" "$STAGE_DIR/packages/cli/"

# Marks a release install for the Pi-side scripts, and is the version file Moonraker's
# `type: zip` updater reads.
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
(cd "$STAGE_DIR" && python3 -m zipfile -c "$OUT_DIR/$RELEASE_NAME.zip" $(ls -A))

echo "Release written to $OUT_DIR:"
ls -lh "$OUT_DIR"
