#!/usr/bin/env bash
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
# Monorepo layout (same for a source checkout and an extracted release):
#   <workspace>/packages/configurator/src/scripts  <- SCRIPT_DIR
#   <workspace>/packages/configurator              <- APP_DIR (package root, .env, configuration/)
#   <workspace>/packages/cli                       <- CLI_DIR
APP_DIR=$(realpath "$SCRIPT_DIR/../..")
BASE_DIR=$APP_DIR
WORKSPACE_DIR=$(realpath "$APP_DIR/../..")
CLI_DIR="$WORKSPACE_DIR/packages/cli"
GIT_DIR=$WORKSPACE_DIR/.git

source "$BASE_DIR/configuration/scripts/environment.sh"

report_status()
{
    echo -e "\n\n###### $1"
}

update_package_managers()
{
    report_status "Updating npm and pnpm..."
    npm update -g npm pnpm
}

install_or_update_service_file()
{
	report_status "Updating service file..."

    sudo groupadd -f ratos-configurator

	SERVICE_FILE="/etc/systemd/system/ratos-configurator.service"
	SERVICE_FILE_TEMPLATE="${SCRIPT_DIR}/service-template.service"

	cp "${SERVICE_FILE_TEMPLATE}" /tmp/ratos-configurator.service
	
	sed -i "s|__APP_DIR__|${APP_DIR}|g" /tmp/ratos-configurator.service
	sed -i "s|__RATOS_USERNAME__|${RATOS_USERNAME}|g" /tmp/ratos-configurator.service
	
	if [ -f "${SERVICE_FILE}" ]; then
		if [ "$(md5sum "${SERVICE_FILE_TEMPLATE}")" != "$(md5sum "${SERVICE_FILE}")" ]; then
			sudo mv /tmp/ratos-configurator.service "${SERVICE_FILE}"
			sudo systemctl daemon-reload
			echo "Service file updated!"
		else
			echo "Service file is already up to date!"
		fi
	else
		echo "Service file does not exist, installing..."
		sudo mv /tmp/ratos-configurator.service "${SERVICE_FILE}"
		sudo systemctl enable ratos-configurator.service
		sudo systemctl daemon-reload
		echo "Service file installed!"
	fi
}

# Release installs are extracted from a GitHub release archive. They contain prebuilt
# output and a release_info.json, and have no .git directory.
is_release_install() {
	[ -f "$WORKSPACE_DIR/release_info.json" ]
}

# Runs a command as the RatOS user when invoked as root, otherwise as the current user.
run_as_ratos_user() {
	if [ "$EUID" -eq 0 ]; then
		sudo -u "${RATOS_USERNAME}" "$@"
	else
		"$@"
	fi
}

pnpm_install() {
	report_status "Installing pnpm dependencies..."
	pushd "$WORKSPACE_DIR" || exit 1
	if [ "$EUID" -eq 0 ]; then
		# Check if node_modules is owned by root and delete
		# Fixes old 2.0 installations
		if [ -d "$WORKSPACE_DIR/node_modules" ] && [ "$(stat -c %U "$WORKSPACE_DIR/node_modules")" == "root" ]; then
			report_status "Deleting root owned node_modules"
			rm -rf "$WORKSPACE_DIR/node_modules"
		fi
	fi
	local install_flags=(--frozen-lockfile --aggregate-output --no-color --config.confirmModulesPurge=false)
	if is_release_install; then
		# Prebuilt release: only runtime dependencies are needed.
		install_flags+=(--prod)
	fi
	run_as_ratos_user pnpm install "${install_flags[@]}"
	popd || exit 1
}

# Records that update.sh/setup.sh finished for the current release, so the service's
# release-update.sh pre-start step doesn't run them again until a new release is extracted.
mark_release_installed() {
	is_release_install || return 0
	local version
	version=$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]*)".*/\1/p' "$WORKSPACE_DIR/release_info.json")
	echo "$version" > "$WORKSPACE_DIR/.ratos-installed-release"
}

# Moonraker wipes the install folder on update and only keeps top-level persistent_files, so on
# release installs the printer's .env.local lives at the install root and is linked into the app.
link_release_env_local() {
	is_release_install || return 0
	local root_env="$WORKSPACE_DIR/.env.local"
	local app_env="$APP_DIR/.env.local"
	if [ -f "$app_env" ] && [ ! -L "$app_env" ]; then
		# Created in the app folder since the last update, so it's the most recent version.
		report_status "Moving $app_env to $root_env so it survives updates"
		mv -f "$app_env" "$root_env"
	fi
	if [ -f "$root_env" ]; then
		ln -sfn ../../.env.local "$app_env"
	fi
}

# Source checkouts don't ship build output; the CLI must be built before `ratos` works.
# The configurator itself is only built on demand (`pnpm --filter ratos-configurator build`),
# a source checkout is typically served with `pnpm --filter ratos-configurator dev`.
build_cli() {
	if is_release_install; then
		return 0
	fi
	report_status "Building RatOS CLI..."
	pushd "$WORKSPACE_DIR" || exit 1
	run_as_ratos_user pnpm --filter ratos-cli run build
	popd || exit 1
}

ensure_pnpm_installation() {
	if ! which pnpm &> /dev/null; then
		report_status "Installing pnpm"
		npm install -g pnpm
		# remove old node modules
		rm -rf "$WORKSPACE_DIR/node_modules"
		pnpm_install
	fi
}

ensure_service_permission()
{
	if ! grep -q "ratos-configurator" "${RATOS_PRINTER_DATA_DIR}/moonraker.asvc"; then
		report_status "Updatin moonraker service permissions"
		printf '\nratos-configurator' >> "${RATOS_PRINTER_DATA_DIR}/moonraker.asvc"
		echo "RatOS added to moonraker service permissions!"
	fi
}

install_hooks()
{
    report_status "Installing git hooks"
	if [ ! -d "$GIT_DIR" ]; then
		echo "No git checkout at $WORKSPACE_DIR (release install), skipping git hooks."
		return 0
	fi
	if [ -L "$GIT_DIR/hooks/post-merge" ]; then
 	   rm "$GIT_DIR/hooks/post-merge"
	fi
	ln -s "$SCRIPT_DIR/post-merge.sh" "$GIT_DIR/hooks/post-merge"
	echo "Post-merge git-hook installed!"
}

install_logrotation() {
    LOGROTATE_FILE="/etc/logrotate.d/ratos-configurator"
    LOGFILE="${RATOS_PRINTER_DATA_DIR}/logs/ratos-configurator.log"
    report_status "Installing RatOS Configurator log rotation script..."
    sudo /bin/sh -c "cat > ${LOGROTATE_FILE}" << __EOF
#### RatOS-configurator
####
#### Written by Mikkel Schmidt <mikkel.schmidt@gmail.com>
#### Copyright 2022
#### https://github.com/Rat-OS/RatOS-Configurator
####
#### This File is distributed under GPLv3
####


${LOGFILE} {
    rotate 3
    missingok
    notifempty
    copy
    daily
    dateext
    dateformat .%Y-%m-%d
    maxsize 10M
}
__EOF
    sudo chmod 644 "$LOGROTATE_FILE"
}

patch_log_rotation() {
	if [ -e /etc/logrotate.d/ratos-configurator ]; then
		if grep -q "${RATOS_PRINTER_DATA_DIR}/logs/ratos-configurator.log" /etc/logrotate.d/ratos-configurator; then
			report_status "Patching log rotation"
			sudo sed -i 's|rotate 4|rotate 3|g' /etc/logrotate.d/ratos-configurator
			sudo sed -i "s|${RATOS_PRINTER_DATA_DIR}/logs/configurator.log|${RATOS_PRINTER_DATA_DIR}/logs/ratos-configurator.log|g" /etc/logrotate.d/ratos-configurator
		fi
	else
		install_logrotation
	fi
}

symlink_configuration() {
	report_status "Symlinking configuration"
	[ -z "$RATOS_PRINTER_DATA_DIR" ] && { echo "Error: RATOS_PRINTER_DATA_DIR not set" >&2; return 1; }
	[ -z "$BASE_DIR" ] && { echo "Error: BASE_DIR not set" >&2; return 1; }
	
	sudo=""
	[ "$EUID" -ne 0 ] && sudo="sudo"
	
	target="${RATOS_PRINTER_DATA_DIR}/config/RatOS"
	source="$BASE_DIR/configuration"
	if [ ! -L "$target" ] || [ ! "$(readlink "$target")" = "$source" ]; then
		$sudo rm -rf "$target" || { echo "Failed to remove old configuration" >&2; return 1; }
		$sudo ln -s "$source" "$target" || { echo "Failed to create symlink" >&2; return 1; }
		echo "Configuration symlink created successfully"
	else
		echo "Configuration already linked, skipping..."
	fi
}

install_cli()
{
	sudo=""
	[ "$EUID" -ne 0 ] && sudo="sudo"
	
	target="/usr/local/bin/ratos"
	source="$CLI_DIR/bin/ratos"
	if [ ! -L "$target" ] || [ ! "$(readlink "$target")" = "$source" ]; then
		report_status "Installing RatOS CLI"
		$sudo rm -f "$target"
		$sudo ln -s "$source" "$target"
		$sudo chmod a+x "$target"
	else
		echo "RatOS CLI already installed, skipping..."
	fi
}

verify_users()
{
	if ! id "${RATOS_USERNAME}" &>/dev/null; then
		echo "User ${RATOS_USERNAME} is not present on the system"
		exit 1
	fi
}

install_udev_rule()
{

	sudo=""
	[ "$EUID" -ne 0 ] && sudo="sudo"

	ratos_source="$SCRIPT_DIR/ratos.rules"
	ratos_target="/etc/udev/rules.d/97-ratos.rules"
	if [ ! -f "$ratos_source" ]; then
		echo "Error: RatOS udev rules source file not found at $ratos_source" >&2
		return 1
	fi
	if [ ! -L "$ratos_target" ] || [ ! "$(readlink "$ratos_target")" = "$ratos_source" ]; then
		report_status "Installing RatOS udev rule"
		$sudo rm -f "$ratos_target"
		$sudo ln -s "$ratos_source" "$ratos_target"
		echo "RatOS udev rule installed!"
	fi

	vaoc_source="$SCRIPT_DIR/vaoc.rules" 
	vaoc_target="/etc/udev/rules.d/97-vaoc.rules"
	if [ ! -f "$vaoc_source" ]; then
		echo "Error: VAOC udev rules source file not found at $vaoc_source" >&2
		return 1
	fi
	if [ ! -L "$vaoc_target" ] || [ ! "$(readlink "$vaoc_target")" = "$vaoc_source" ]; then
		report_status "Installing VAOC udev rule"
		$sudo rm -f "$vaoc_target"
		$sudo ln -s "$vaoc_source" "$vaoc_target"
		echo "VAOC udev rule installed!"
	fi
}

ensure_sudo_command_whitelisting()
{

	sudo=""
	[ "$EUID" -ne 0 ] && sudo="sudo"

    report_status "Updating whitelisted commands"
	# Whitelist RatOS configurator git hook scripts
	if [[ -e /etc/sudoers.d/030-ratos-configurator-githooks ]]
	then
		$sudo rm /etc/sudoers.d/030-ratos-configurator-githooks
	fi
	touch /tmp/030-ratos-configurator-githooks
	cat << __EOF > /tmp/030-ratos-configurator-githooks
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/update.sh
__EOF

	$sudo chown root:root /tmp/030-ratos-configurator-githooks
	$sudo chmod 440 /tmp/030-ratos-configurator-githooks
	$sudo cp --preserve=mode /tmp/030-ratos-configurator-githooks /etc/sudoers.d/030-ratos-configurator-githooks

	echo "RatOS configurator git hooks has successfully been whitelisted!"

	# Whitelist configurator scripts
	if [[ -e /etc/sudoers.d/030-ratos-configurator-scripts ]]
	then
		$sudo rm /etc/sudoers.d/030-ratos-configurator-scripts
	fi
	touch /tmp/030-ratos-configurator-scripts
	cat << __EOF > /tmp/031-ratos-configurator-scripts
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/add-wifi-network.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/change-hostname.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/dfu-flash.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/board-script.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/flash-path.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/klipper-compile.sh
__EOF

	$sudo chown root:root /tmp/031-ratos-configurator-scripts
	$sudo chmod 440 /tmp/031-ratos-configurator-scripts
	$sudo cp --preserve=mode /tmp/031-ratos-configurator-scripts /etc/sudoers.d/031-ratos-configurator-scripts

	echo "RatOS configurator scripts has successfully been whitelisted!"

	# Whitelist configurator commands
	if [[ -e /etc/sudoers.d/031-ratos-configurator-wifi ]]
	then
		$sudo rm /etc/sudoers.d/031-ratos-configurator-wifi
	fi
	touch /tmp/031-ratos-configurator-wifi
	cat << __EOF > /tmp/031-ratos-configurator-wifi
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: /usr/sbin/iw
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: /usr/sbin/wpa_cli
__EOF

	$sudo chown root:root /tmp/031-ratos-configurator-wifi
	$sudo chmod 440 /tmp/031-ratos-configurator-wifi
	$sudo cp --preserve=mode /tmp/031-ratos-configurator-wifi /etc/sudoers.d/031-ratos-configurator-wifi

	echo "RatOS configurator commands has successfully been whitelisted!"
}
