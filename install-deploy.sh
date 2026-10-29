#!/bin/sh
set -eu

BASJOO_REPO_URL=${BASJOO_REPO_URL:-https://github.com/haoyiyin/basjoo}
BASJOO_BRANCH=${BASJOO_BRANCH:-main}
BASJOO_FORCE_CLEAN=${BASJOO_FORCE_CLEAN:-1}
INSTALL_DOCKER_URL=${INSTALL_DOCKER_URL:-https://get.docker.com}

have_cmd() {
	command -v "$1" >/dev/null 2>&1
}

log() {
	printf '%s\n' "==> $*"
}

fail() {
	printf '%s\n' "Error: $*" >&2
	exit 1
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
IS_REPO_SCRIPT=0
if [ -f "$SCRIPT_DIR/deploy.sh" ] && [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
	IS_REPO_SCRIPT=1
fi

if [ "$(id -u)" -eq 0 ]; then
	SUDO=
else
	SUDO=sudo
fi

if [ -n "$SUDO" ] && ! have_cmd sudo; then
	fail "sudo is required when running as a non-root user."
fi

run_root() {
	if [ -n "$SUDO" ]; then
		"$SUDO" "$@"
	else
		"$@"
	fi
}

if [ "$IS_REPO_SCRIPT" -eq 1 ]; then
	DEFAULT_BASJOO_DIR=$SCRIPT_DIR
elif [ "$(id -u)" -eq 0 ]; then
	DEFAULT_BASJOO_DIR=/opt/basjoo
else
	DEFAULT_BASJOO_DIR=$HOME/basjoo
fi

BASJOO_DIR=${BASJOO_DIR:-$DEFAULT_BASJOO_DIR}

APT_CMD=
APT_UPDATED=0

# Prefer the plain `docker` binary when this user can already reach the daemon
# (docker group, rootless, or root). Falling back to sudo unconditionally breaks
# hosts where the Compose plugin is only installed for the invoking user
# (~/.docker/cli-plugins), because sudo then sees a docker without compose.
if docker info >/dev/null 2>&1; then
	DOCKER_BIN=docker
elif [ -n "$SUDO" ]; then
	DOCKER_BIN='sudo docker'
else
	DOCKER_BIN=docker
fi

detect_platform() {
	[ -r /etc/os-release ] || fail "Unsupported system: /etc/os-release is missing."

	ID=
	ID_LIKE=
	. /etc/os-release

	is_debian_family=0
	case "${ID:-}" in
	ubuntu | debian)
		is_debian_family=1
		;;
	esac
	case "${ID_LIKE:-}" in
	*debian*)
		is_debian_family=1
		;;
	esac

	if [ "$is_debian_family" -eq 1 ]; then
		if have_cmd apt-get; then
			APT_CMD=apt-get
		elif have_cmd apt; then
			APT_CMD=apt
		fi
	fi

	if [ -z "$APT_CMD" ]; then
		# Unknown distro: only continue when the machine already has what we need.
		if have_cmd docker && compose_ok; then
			log "Non-Debian system (${PRETTY_NAME:-${ID:-unknown}}) with Docker already installed — skipping package setup"
			return 0
		fi
		fail "Automatic install supports Ubuntu and Debian. On ${PRETTY_NAME:-${ID:-this system}}, install Docker Engine with the Compose plugin and git + python3 yourself, then re-run this script."
	fi
}

apt_install() {
	if [ "$APT_UPDATED" -eq 0 ]; then
		log "Updating package index"
		run_root env DEBIAN_FRONTEND=noninteractive "$APT_CMD" update
		APT_UPDATED=1
	fi

	run_root env DEBIAN_FRONTEND=noninteractive "$APT_CMD" install -y "$@"
}

ensure_base_dependencies() {
	# Non-Debian hosts have no package manager here, so just require the tools.
	if [ -z "$APT_CMD" ]; then
		for cmd in git python3; do
			have_cmd "$cmd" || fail "$cmd is required but missing. Install it with your distribution's package manager and re-run."
		done
		return 0
	fi

	# Everything below is only needed if it is actually missing. A host with a
	# working toolchain must not be blocked by a broken apt mirror — that is a
	# common state behind corporate proxies and in offline/air-gapped setups.
	missing=
	for cmd in git python3 curl; do
		have_cmd "$cmd" || missing="$missing $cmd"
	done
	for pkg in ca-certificates; do
		[ -e "/etc/ssl/certs/ca-certificates.crt" ] || missing="$missing $pkg"
	done
	if ! have_cmd lsblk; then
		missing="$missing util-linux"
	fi

	if [ -z "$missing" ]; then
		log "Required system packages are already present"
		return 0
	fi

	log "Installing missing system packages:$missing"
	apt_install $missing
}

download_file() {
	url=$1
	output=$2

	if have_cmd curl; then
		curl -fsSL "$url" -o "$output"
		return 0
	fi

	if have_cmd wget; then
		wget -qO "$output" "$url"
		return 0
	fi

	fail "Neither curl nor wget is available for downloading required files."
}

# Both probes must test the same binary the deploy step will use (DOCKER_BIN),
# otherwise a user-scoped Compose plugin looks "missing" under sudo and triggers a
# pointless reinstall.
compose_ok() {
	$DOCKER_BIN compose version >/dev/null 2>&1
}

ensure_docker() {
	if have_cmd docker && compose_ok; then
		log "Docker Engine and Docker Compose are already installed"
	else
		log "Installing Docker Engine and Docker Compose"
		installer=$(mktemp)
		trap 'rm -f "$installer"' EXIT HUP INT TERM
		download_file "$INSTALL_DOCKER_URL" "$installer"
		run_root sh "$installer"
		rm -f "$installer"
		trap - EXIT HUP INT TERM
	fi

	if have_cmd systemctl; then
		run_root systemctl enable --now docker >/dev/null 2>&1 || true
	elif have_cmd service; then
		run_root service docker start >/dev/null 2>&1 || true
	fi

	# systemd may be absent (containers, WSL without systemd) — what matters is that
	# the daemon actually answers, not that a unit was enabled.
	have_cmd docker || fail "Docker CLI is still unavailable after installation."
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		$DOCKER_BIN info >/dev/null 2>&1 && break
		sleep 2
	done
	$DOCKER_BIN info >/dev/null 2>&1 || fail "Docker daemon is not reachable. Start it (e.g. 'sudo systemctl start docker') and re-run."
	compose_ok || fail "Docker Compose plugin is unavailable after installation."
}

ensure_repo_dir_ready() {
	parent_dir=$(dirname "$BASJOO_DIR")
	if [ ! -d "$parent_dir" ]; then
		log "Creating parent directory $parent_dir"
		run_root mkdir -p "$parent_dir"
		if [ -n "$SUDO" ]; then
			run_root chown "$(id -u):$(id -g)" "$parent_dir"
		fi
	fi
}

# git refuses to operate on a repo owned by another user. Running this script as
# `sudo sh install-deploy.sh` inside your own checkout makes git run as root on a
# user-owned tree, so every call goes through this wrapper.
gitc() {
	git -c safe.directory="$BASJOO_DIR" -c safe.directory="$SCRIPT_DIR" "$@"
}

clone_repo() {
	ensure_repo_dir_ready
	if [ ! -d "$BASJOO_DIR" ]; then
		run_root mkdir -p "$BASJOO_DIR"
		if [ -n "$SUDO" ]; then
			run_root chown "$(id -u):$(id -g)" "$BASJOO_DIR"
		fi
	fi
	log "Cloning $BASJOO_REPO_URL into $BASJOO_DIR"
	gitc clone --branch "$BASJOO_BRANCH" "$BASJOO_REPO_URL" "$BASJOO_DIR"
}

sync_repo() {
	if [ -e "$BASJOO_DIR" ] && [ ! -d "$BASJOO_DIR" ]; then
		fail "Target path $BASJOO_DIR exists and is not a directory."
	fi

	if [ ! -e "$BASJOO_DIR" ]; then
		clone_repo
		return 0
	fi

	if [ -d "$BASJOO_DIR/.git" ]; then
		log "Syncing repository to $BASJOO_REPO_URL#$BASJOO_BRANCH"
		if gitc -C "$BASJOO_DIR" remote get-url origin >/dev/null 2>&1; then
			gitc -C "$BASJOO_DIR" remote set-url origin "$BASJOO_REPO_URL"
		else
			gitc -C "$BASJOO_DIR" remote add origin "$BASJOO_REPO_URL"
		fi
		gitc -C "$BASJOO_DIR" fetch --prune origin "$BASJOO_BRANCH"
		gitc -C "$BASJOO_DIR" reset --hard
		gitc -C "$BASJOO_DIR" checkout -B "$BASJOO_BRANCH" FETCH_HEAD
		if [ "$BASJOO_FORCE_CLEAN" = "1" ] || [ "$BASJOO_FORCE_CLEAN" = "true" ] || [ "$BASJOO_FORCE_CLEAN" = "yes" ]; then
			gitc -C "$BASJOO_DIR" clean -fd
		fi
		gitc -C "$BASJOO_DIR" reset --hard FETCH_HEAD
		return 0
	fi

	if [ -d "$BASJOO_DIR" ] && [ -n "$(ls -A "$BASJOO_DIR" 2>/dev/null)" ]; then
		fail "Target directory $BASJOO_DIR exists but is not a git repository."
	fi

	clone_repo
}

container_state() {
	$DOCKER_BIN inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || true
}

wait_for_container() {
	container_name=$1
	expected_state=$2
	timeout_seconds=$3
	start_time=$(date +%s)

	while :; do
		current_state=$(container_state "$container_name")
		if [ "$current_state" = "$expected_state" ]; then
			return 0
		fi

		now=$(date +%s)
		if [ $((now - start_time)) -ge "$timeout_seconds" ]; then
			return 1
		fi

		sleep 2
	done
}

read_env_value() {
	key=$1
	env_file=$2

	[ -f "$env_file" ] || return 0

	value=$(grep -E "^[[:space:]]*$key=" "$env_file" | tail -n 1 | cut -d= -f2- || true)
	case "$value" in
	\"*\")
		value=${value#\"}
		value=${value%\"}
		;;
	\'.*\')
		value=${value#\'}
		value=${value%\'}
		;;
	esac

	printf '%s' "$value"
}

http_get() {
	url=$1
	host_header=${2:-}

	if have_cmd curl; then
		if [ -n "$host_header" ]; then
			curl -fsS --max-time 10 -H "Host: $host_header" "$url" >/dev/null
		else
			curl -fsS --max-time 10 "$url" >/dev/null
		fi
		return $?
	fi

	if [ -n "$host_header" ]; then
		wget -qO /dev/null --header="Host: $host_header" "$url"
	else
		wget -qO /dev/null "$url"
	fi
}

show_failure_logs() {
	log "Recent backend logs"
	$DOCKER_BIN compose --project-directory "$BASJOO_DIR" --profile prod logs --tail=100 backend-prod || true
	log "Recent frontend logs"
	$DOCKER_BIN compose --project-directory "$BASJOO_DIR" --profile prod logs --tail=100 frontend-prod || true
	log "Recent nginx logs"
	$DOCKER_BIN compose --project-directory "$BASJOO_DIR" --profile prod logs --tail=100 nginx || true
}

verify_deployment() {
	log "Waiting for container health checks"
	wait_for_container basjoo-redis healthy 120 || {
		show_failure_logs
		fail "Redis did not become healthy in time."
	}
	wait_for_container basjoo-qdrant healthy 120 || {
		show_failure_logs
		fail "Qdrant did not become healthy in time."
	}
	wait_for_container basjoo-backend healthy 180 || {
		show_failure_logs
		fail "Backend did not become healthy in time."
	}
	wait_for_container basjoo-frontend healthy 180 || {
		show_failure_logs
		fail "Frontend did not become healthy in time."
	}
	wait_for_container basjoo-nginx running 120 || {
		show_failure_logs
		fail "nginx did not enter the running state in time."
	}

	log "Checking production stack status"
	$DOCKER_BIN compose --project-directory "$BASJOO_DIR" --profile prod ps

	server_domain=$(read_env_value SERVER_DOMAIN "$BASJOO_DIR/.env")
	if [ -n "$server_domain" ]; then
		log "Checking /health through nginx with Host: $server_domain"
		http_get "http://127.0.0.1/health" "$server_domain" || {
			show_failure_logs
			fail "Health check through nginx failed for SERVER_DOMAIN=$server_domain."
		}
	else
		log "Checking /health through nginx"
		http_get "http://127.0.0.1/health" || {
			show_failure_logs
			fail "Health check through nginx failed."
		}
	fi
}

print_summary() {
	server_domain=$(read_env_value SERVER_DOMAIN "$BASJOO_DIR/.env")
	cert_path=
	if [ -r "$BASJOO_DIR/ssl/fullchain.pem" ] || [ -r "$BASJOO_DIR/ssl/cert.pem" ]; then
		cert_path=1
	fi
	key_path=
	if [ -r "$BASJOO_DIR/ssl/key.pem" ]; then
		key_path=1
	fi

	# Compute admin URL
	admin_url=
	if [ -n "$server_domain" ]; then
		if [ -n "$cert_path" ] && [ -n "$key_path" ]; then
			admin_url="https://$server_domain"
		else
			admin_url="http://$server_domain"
		fi
	else
		admin_url="http://<server-ip-or-domain>"
	fi

	printf '%s\n' ''
	printf '%s\n' '=========================================='
	printf '%s\n' '   Basjoo deployment is ready!           '
	printf '%s\n' '=========================================='
	printf '%s\n' ''
	printf 'Project directory: %s\n' "$BASJOO_DIR"
	printf '%s\n' ''
	printf '%s\n' 'Admin dashboard:'
	printf '  %s\n' "$admin_url"
	printf '%s\n' ''
	printf '%s\n' 'First-time setup:'
	printf '%s\n' '  1. Open the Admin URL in your browser'
	printf '%s\n' '  2. Register your admin account (becomes workspace super admin)'
	printf '%s\n' '  3. Configure your AI agents and API keys'
	printf '%s\n' ''
	printf 'Status command: %s\n' "$DOCKER_BIN compose --project-directory $BASJOO_DIR --profile prod ps"
	printf 'Log command: %s\n' "$DOCKER_BIN compose --project-directory $BASJOO_DIR --profile prod logs -f backend-prod nginx"

	# Best-effort auto-open in background (skip if BASJOO_AUTO_OPEN=0 or placeholder URL)
	if [ "${BASJOO_AUTO_OPEN:-1}" != "0" ] && [ "$admin_url" != "http://<server-ip-or-domain>" ]; then
		if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
			if command -v xdg-open >/dev/null 2>&1; then
				printf '%s\n' ''
				printf '%s\n' 'Attempting to open admin dashboard in browser...'
				(xdg-open "$admin_url" >/dev/null 2>&1 || true) &
			fi
		elif command -v open >/dev/null 2>&1; then
			# macOS fallback (unlikely on Ubuntu/Debian but harmless)
			printf '%s\n' ''
			printf '%s\n' 'Attempting to open admin dashboard in browser...'
			(open "$admin_url" >/dev/null 2>&1 || true) &
		fi
	fi
}

deploy_repo() {
	[ -f "$BASJOO_DIR/deploy.sh" ] || fail "deploy.sh was not found in $BASJOO_DIR."
	[ -f "$BASJOO_DIR/docker-compose.yml" ] || fail "docker-compose.yml was not found in $BASJOO_DIR."

	log "Running Basjoo production deployment"
	BASJOO_DOCKER_BIN="$DOCKER_BIN" sh "$BASJOO_DIR/deploy.sh"
}

main() {
	detect_platform
	ensure_base_dependencies
	ensure_docker
	sync_repo
	deploy_repo
	verify_deployment
	print_summary
}

main "$@"
