#!/usr/bin/env bash
# Shared setup for the configurator's helper scripts (flashing, board scripts, klipper compile).
# System installation lives in the RatOS image build (modules/generic/70-ratos at the workspace root);
# updates are handled by Moonraker.
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
# <install>/packages/configurator, which holds configuration/
APP_DIR=$(realpath "$SCRIPT_DIR/../..")
BASE_DIR=$APP_DIR

# shellcheck source=configuration/scripts/environment.sh
source "$BASE_DIR/configuration/scripts/environment.sh"

report_status()
{
    echo -e "\n\n###### $1"
}
