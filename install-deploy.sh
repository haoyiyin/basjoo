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
DOCKER_BIN=docker

if [ -n "$SUDO" ]; then
  DOCKER_BIN='sudo docker'
fi

detect_platform() {
  [ -r /etc/os-release ] || fail "Unsupported system: /etc/os-release is missing."

  ID=
  ID_LIKE=
  . /etc/os-release

  is_debian_family=0
  case "${ID:-}" in
    ubuntu|debian)
      is_debian_family=1
      ;;
  esac
  case "${ID_LIKE:-}" in
    *debian*)
      is_debian_family=1
      ;;
  esac

  [ "$is_debian_family" -eq 1 ] || fail "This installer currently supports Ubuntu and Debian only."

  if have_cmd apt-get; then
    APT_CMD=apt-get
  elif have_cmd apt; then
    APT_CMD=apt
  else
    fail "No apt package manager was found. On Ubuntu/Debian, install apt first or use a standard system image."
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
  packages="ca-certificates git python3 curl wget"
  if ! have_cmd lsblk; then
    packages="$packages util-linux"
  fi
  log "Installing required system packages"
  apt_install $packages
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

ensure_docker() {
  if have_cmd docker && run_root docker compose version >/dev/null 2>&1; then
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
    run_root systemctl enable --now docker
  elif have_cmd service; then
    run_root service docker start
  fi

  have_cmd docker || fail "Docker CLI is still unavailable after installation."
  run_root docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is unavailable after installation."
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

clone_repo() {
  ensure_repo_dir_ready
  if [ ! -d "$BASJOO_DIR" ]; then
    run_root mkdir -p "$BASJOO_DIR"
    if [ -n "$SUDO" ]; then
      run_root chown "$(id -u):$(id -g)" "$BASJOO_DIR"
    fi
  fi
  log "Cloning $BASJOO_REPO_URL into $BASJOO_DIR"
  git clone --branch "$BASJOO_BRANCH" "$BASJOO_REPO_URL" "$BASJOO_DIR"
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
    if git -C "$BASJOO_DIR" remote get-url origin >/dev/null 2>&1; then
      git -C "$BASJOO_DIR" remote set-url origin "$BASJOO_REPO_URL"
    else
      git -C "$BASJOO_DIR" remote add origin "$BASJOO_REPO_URL"
    fi
    git -C "$BASJOO_DIR" fetch --prune origin "$BASJOO_BRANCH"
    git -C "$BASJOO_DIR" reset --hard
    git -C "$BASJOO_DIR" checkout -B "$BASJOO_BRANCH" FETCH_HEAD
    if [ "$BASJOO_FORCE_CLEAN" = "1" ] || [ "$BASJOO_FORCE_CLEAN" = "true" ] || [ "$BASJOO_FORCE_CLEAN" = "yes" ]; then
      git -C "$BASJOO_DIR" clean -fd
    fi
    git -C "$BASJOO_DIR" reset --hard FETCH_HEAD
    return 0
  fi

  if [ -d "$BASJOO_DIR" ] && [ -n "$(ls -A "$BASJOO_DIR" 2>/dev/null)" ]; then
    fail "Target directory $BASJOO_DIR exists but is not a git repository."
  fi

  clone_repo
}

container_state() {
  run_root docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || true
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
    return 0
  fi

  if [ -n "$host_header" ]; then
    wget -qO /dev/null --header="Host: $host_header" "$url"
  else
    wget -qO /dev/null "$url"
  fi
}

show_failure_logs() {
  log "Recent backend logs"
  run_root docker compose --project-directory "$BASJOO_DIR" --profile prod logs --tail=100 backend-prod || true
  log "Recent frontend logs"
  run_root docker compose --project-directory "$BASJOO_DIR" --profile prod logs --tail=100 frontend-prod || true
  log "Recent nginx logs"
  run_root docker compose --project-directory "$BASJOO_DIR" --profile prod logs --tail=100 nginx || true
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
  run_root docker compose --project-directory "$BASJOO_DIR" --profile prod ps

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

  printf '%s\n' ''
  printf '%s\n' 'Basjoo deployment is ready.'
  printf 'Project directory: %s\n' "$BASJOO_DIR"
  if [ -n "$server_domain" ]; then
    if [ -n "$cert_path" ] && [ -n "$key_path" ]; then
      printf 'Access URL: %s\n' "https://$server_domain"
    else
      printf 'Access URL: %s\n' "http://$server_domain"
    fi
  else
    printf '%s\n' 'Access URL: http://<server-ip-or-domain>'
  fi
  printf 'Status command: %s\n' "$DOCKER_BIN compose --project-directory $BASJOO_DIR --profile prod ps"
  printf 'Log command: %s\n' "$DOCKER_BIN compose --project-directory $BASJOO_DIR --profile prod logs -f backend-prod nginx"
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
