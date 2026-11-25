#!/usr/bin/env bash
SCRIPT_DIR=$( cd -- "$( dirname -- "$(realpath -- "${BASH_SOURCE[0]}")" )" &> /dev/null && pwd )

# shellcheck source=./configuration/scripts/environment.sh
source "$SCRIPT_DIR"/environment.sh

# Helper to conditionally use sudo (for compatibility with systemd-nspawn/containers)
# When running as root (EUID=0), commands are executed directly
# When not root, sudo is used for privilege escalation
if [ "$EUID" -eq 0 ]; then
    SUDO=""
else
    SUDO="sudo"
fi

# Helper to run commands as a specific user
# Only uses sudo -u if we're not already running as the target user
run_as_user() {
    local username="$1"
    shift
	# If running as root or as a different user, use sudo -u
	if [ "$EUID" -eq 0 ] || [ "$(whoami)" != "$username" ]; then
        # Need to switch users, use sudo -u
        sudo -u "$username" "$@"
    else
        # Already the target user, run directly
        "$@"
    fi
}

# System package requirements for RatOS (read by Moonraker and scripts)
# shellcheck disable=SC2034
PKGLIST="python3-numpy python3-matplotlib curl git libopenblas-base"

report_status()
{
    echo -e "\n\n###### $1"
}

disable_modem_manager()
{
	report_status "Checking if ModemManager is enabled..."
	
	if ! $SUDO systemctl is-enabled ModemManager.service &> /dev/null; then
		report_status "Disabling ModemManager..."
		$SUDO systemctl disable ModemManager.service
	else
		report_status "ModemManager is already disabled.."
	fi
	report_status "Masking ModemManager to ensure it won't start in the future..."
	$SUDO systemctl mask ModemManager.service
}

update_beacon_fw()
{
	report_status "Updating beacon firmware..."
	if [ ! -d "$BEACON_DIR" ] || [ ! -e "$KLIPPER_DIR/klippy/extras/beacon.py" ]; then
		echo "beacon: beacon isn't installed, skipping..."
		return
	fi

	if [ ! -d "$KLIPPER_DIR" ] || [ ! -d "$KLIPPER_ENV" ]; then
		echo "beacon: klipper or klippy env doesn't exist"
		return
	fi

	if [ ! -f "$BEACON_DIR/update_firmware.py" ]; then
		echo "beacon: beacon firmware updater script doesn't exist, skipping..."
		return
	fi

	if [ ! -d /sys/bus/usb/devices ]; then
		echo "beacon: no usb devices present, skipping firmware update..."
		return
	fi

	"$KLIPPER_ENV"/bin/python "$BEACON_DIR"/update_firmware.py update all --no-sudo
}

install_beacon()
{
    report_status "Installing beacon module..."

	if [ -d "$BEACON_DIR" ] || [ -e "$KLIPPER_DIR/klippy/extras/beacon.py" ]; then
		echo "beacon: beacon already installed, skipping..."
		return
	fi

	if [ ! -d "$KLIPPER_DIR" ] || [ ! -d "$KLIPPER_ENV" ]; then
		echo "beacon: klipper or klippy env doesn't exist"
		return
	fi

	git clone https://github.com/beacon3d/beacon_klipper.git "$BEACON_DIR"
	chown -R "${RATOS_USERNAME}:${RATOS_USERGROUP}" "$BEACON_DIR"

	# install beacon requirements to env
	echo "beacon: installing python requirements to env."
	if [ "$EUID" -eq 0 ]; then
		# Running as root, use su to run pip as the correct user
		su - "${RATOS_USERNAME}" -c "\"${KLIPPER_ENV}\"/bin/pip install -r \"${BEACON_DIR}\"/requirements.txt"
	else
		# Running as user, can run pip directly
		"${KLIPPER_ENV}"/bin/pip install -r "${BEACON_DIR}"/requirements.txt
	fi

	# The configurator registers the Beacon extension when it starts.
}

regenerate_config() {
    report_status "Regenerating RatOS configuration via RatOS Configurator..."

    ratos config regenerate
}

remove_old_postprocessor()
{
	if [ -L "${KLIPPER_DIR}/klippy/extras/ratos_post_processor.py" ]; then
		report_status "Removing legacy post-processor..."
		rm "${KLIPPER_DIR}/klippy/extras/ratos_post_processor.py"
		echo "Legacy post-processor removed!"
	fi
}

ensure_service_permission()
{
    report_status "Ensuring moonraker service permissions..."
    
    local asvc_file="${RATOS_PRINTER_DATA_DIR}/moonraker.asvc"
    
    # Define required service entries
    local required_services=(
        "klipper_mcu"
        "webcamd"
        "MoonCord"
        "KlipperScreen"
        "moonraker-telegram-bot"
        "moonraker-obico"
        "sonar"
        "crowsnest"
        "octoeverywhere"
        "ratos-configurator"
    )
    
    # Create file if it doesn't exist
    if [ ! -e "$asvc_file" ]; then
        touch "$asvc_file"
        echo "Created moonraker service permissions file"
    fi
    
    # Ensure file ends with newline if it has content
    if [ -s "$asvc_file" ] && [ "$(tail -c 1 "$asvc_file" 2>/dev/null | wc -l)" -eq 0 ]; then
        echo "" >> "$asvc_file"
    fi
    
    # Check for missing entries and add them
    local added_count=0
    for service in "${required_services[@]}"; do
        # Check if service exists in file (ignoring leading/trailing whitespace)
        # Use awk to trim whitespace from each line and compare
        if ! awk -v service="$service" 'BEGIN {found=0} {gsub(/^[[:space:]]+|[[:space:]]+$/, ""); if ($0 == service) found=1} END {exit !found}' "$asvc_file" 2>/dev/null; then
            echo "$service" >> "$asvc_file"
            echo "Added service permission: $service"
            ((added_count++))
        fi
    done
    
    # Ensure correct ownership if running as root
    if [ "$EUID" -eq 0 ]; then
        chown "${RATOS_USERNAME}:${RATOS_USERGROUP}" "$asvc_file"
    fi
    
    if [ "$added_count" -gt 0 ]; then
        echo "Added $added_count service permission(s) to moonraker.asvc"
    else
        echo "All required service permissions already present"
    fi
}

patch_klipperscreen_service_restarts()
{
	if grep "StartLimitIntervalSec=0" /etc/systemd/system/klipperscreen.service &>/dev/null; then
		report_status "Patching KlipperScreen service restarts..."
		# Fix restarts
		$SUDO sed -i 's/\RestartSec=1/\RestartSec=5/g' /etc/systemd/system/KlipperScreen.service
		$SUDO sed -i 's/\StartLimitIntervalSec=0/\StartLimitIntervalSec=100\nStartLimitBurst=4/g' /etc/systemd/system/KlipperScreen.service
		$SUDO systemctl daemon-reload
		echo "KlipperScreen service patched!"
	fi
}

ensure_sudo_command_whitelisting()
{
    report_status "Updating whitelisted commands"
	# Whitelist the RatOS maintenance scripts (the file name is kept so it replaces the old one)
	if [[ -e /etc/sudoers.d/030-ratos-githooks ]]
	then
		$SUDO rm /etc/sudoers.d/030-ratos-githooks
	fi
	touch /tmp/030-ratos-githooks
	cat <<EOF > /tmp/030-ratos-githooks
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: ${RATOS_PRINTER_DATA_DIR}/config/RatOS/scripts/ratos-update.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: ${RATOS_PRINTER_DATA_DIR}/config/RatOS/scripts/klipper-mcu-update.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: ${RATOS_PRINTER_DATA_DIR}/config/RatOS/scripts/beacon-update.sh
EOF

	$SUDO chown root:root /tmp/030-ratos-githooks
	$SUDO chmod 440 /tmp/030-ratos-githooks
	$SUDO cp --preserve=mode /tmp/030-ratos-githooks /etc/sudoers.d/030-ratos-githooks

	echo "RatOS maintenance scripts have been whitelisted!"
}

