#!/usr/bin/env bash
#
# Finishes installing a GitHub release of the RatOS configurator.
#
# Moonraker's `type: zip` updater replaces the install folder with the new release and restarts the
# ratos-configurator service, but it can't run pnpm or our install scripts. The service runs this
# script around every start instead (see service-template.service):
#
#   pre-start   (ExecStartPre, as root)  runs update.sh when this release hasn't been installed yet:
#               dependencies, CLI link, udev rules, sudoers, service file, .env.local link.
#   post-start  (ExecStartPost, as root) when this release hasn't been configured yet, queues
#               `configure` in a transient unit so the service start isn't held up.
#   configure   waits for the configurator to answer, then runs ratos-update.sh, which registers
#               Klipper extensions through the running configurator.
#
# Progress is tracked with stamp files in the install folder. Moonraker wipes that folder on update,
# so a new release always runs both steps again. Source checkouts are updated by the git post-merge
# hook instead, so every mode does nothing there.

set -uo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "$(realpath -- "${BASH_SOURCE[0]}")" )" &> /dev/null && pwd )
APP_DIR=$(realpath "$SCRIPT_DIR/../..")
WORKSPACE_DIR=$(realpath "$APP_DIR/../..")
RELEASE_INFO="$WORKSPACE_DIR/release_info.json"
INSTALLED_STAMP="$WORKSPACE_DIR/.ratos-installed-release"
CONFIGURED_STAMP="$WORKSPACE_DIR/.ratos-configured-release"
POST_UPDATE_UNIT="ratos-configurator-post-update"

if [ ! -f "$RELEASE_INFO" ]; then
	exit 0
fi

VERSION=$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]*)".*/\1/p' "$RELEASE_INFO")
if [ -z "$VERSION" ]; then
	echo "release-update: no version in $RELEASE_INFO, skipping." >&2
	exit 0
fi

stamp_is_current() {
	[ -f "$1" ] && [ "$(cat "$1")" = "$VERSION" ]
}

case "${1:-}" in
	pre-start)
		if stamp_is_current "$INSTALLED_STAMP"; then
			exit 0
		fi
		echo "release-update: installing RatOS configurator release $VERSION..."
		# update.sh writes $INSTALLED_STAMP when it completes.
		if ! "$SCRIPT_DIR/update.sh"; then
			echo "release-update: update.sh failed for release $VERSION, it will be retried on the next start." >&2
			exit 1
		fi
		;;
	post-start)
		if stamp_is_current "$CONFIGURED_STAMP"; then
			exit 0
		fi
		echo "release-update: queueing RatOS configuration update for release $VERSION..."
		systemd-run --unit="$POST_UPDATE_UNIT" --collect --no-block "$SCRIPT_DIR/release-update.sh" configure ||
			echo "release-update: could not queue $POST_UPDATE_UNIT (already running?)" >&2
		exit 0
		;;
	configure)
		if stamp_is_current "$CONFIGURED_STAMP"; then
			exit 0
		fi
		# ratos-update.sh talks to the configurator (extension registration), wait until it answers.
		curl -s -o /dev/null --retry 60 --retry-all-errors --retry-delay 2 --retry-max-time 300 \
			"http://localhost:3000/configure" || echo "release-update: configurator did not answer, continuing anyway." >&2
		if "$APP_DIR/configuration/scripts/ratos-update.sh"; then
			echo "$VERSION" > "$CONFIGURED_STAMP"
		else
			echo "release-update: ratos-update.sh failed for release $VERSION, it will be retried on the next start." >&2
			exit 1
		fi
		;;
	*)
		echo "Usage: $0 pre-start|post-start|configure" >&2
		exit 2
		;;
esac
