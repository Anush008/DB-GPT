#!/usr/bin/env bash
# common.sh - Shared utility functions for DB-GPT installer
# shellcheck disable=SC2034

# ── Colors ────────────────────────────────────────────────────────────────────
readonly COLOR_RESET='\033[0m'
readonly COLOR_RED='\033[1;31m'
readonly COLOR_GREEN='\033[1;32m'
readonly COLOR_YELLOW='\033[1;33m'
readonly COLOR_BLUE='\033[1;34m'
readonly COLOR_CYAN='\033[1;36m'

# ── Logging ───────────────────────────────────────────────────────────────────
info() {
  printf "${COLOR_BLUE}[INFO]${COLOR_RESET} %s\n" "$*"
}

warn() {
  printf "${COLOR_YELLOW}[WARN]${COLOR_RESET} %s\n" "$*"
}

error() {
  printf "${COLOR_RED}[ERROR]${COLOR_RESET} %s\n" "$*" >&2
}

success() {
  printf "${COLOR_GREEN}[OK]${COLOR_RESET} %s\n" "$*"
}

prompt_input() {
  local prompt="$1"
  local __resultvar="$2"
  local answer=""

  if [[ -r /dev/tty ]]; then
    if read -r -p "${prompt}" answer < /dev/tty 2>/dev/null; then
      printf -v "${__resultvar}" '%s' "${answer}"
      return
    fi
  fi

  if [[ -t 0 ]]; then
    read -r -p "${prompt}" answer || die "Failed to read input from stdin."
  else
    die "Interactive input requires a terminal. Re-run with explicit flags such as --profile <name> or --yes."
  fi

  printf -v "${__resultvar}" '%s' "${answer}"
}

die() {
  error "$*"
  exit 1
}

# ── Command helpers ───────────────────────────────────────────────────────────

# Check that a command exists, die if not.
require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    die "Required command not found: ${cmd}. Please install it first."
  fi
}

# Run a command with a description printed before it.
run() {
  local desc="$1"
  shift
  info "${desc}"
  if ! "$@"; then
    die "Command failed: $*"
  fi
}

# ── Interactive helpers ───────────────────────────────────────────────────────

# Ask a yes/no question.  Respects the global YES flag for non-interactive use.
confirm() {
  local prompt="$1"

  if [[ "${YES:-false}" == "true" ]]; then
    return 0
  fi

  local answer
  prompt_input "${prompt} [y/N]: " answer
  [[ "${answer}" =~ ^[Yy]$ ]]
}

# ── String helpers ────────────────────────────────────────────────────────────

# Replace a placeholder token inside a file with a real value.
# Usage: replace_token <file> <token> <value>
# Example: replace_token config.toml "__OPENAI_API_KEY__" "sk-xxx"
replace_token() {
  local file="$1"
  local token="$2"
  local value="$3"

  if [[ ! -f "${file}" ]]; then
    die "replace_token: file not found: ${file}"
  fi

  # Use python3 for safe in-place replacement (avoids sed portability issues
  # between macOS and Linux).  We pass values through environment variables to
  # avoid shell-injection via triple-quote escapes.
  _RT_FILE="${file}" _RT_TOKEN="${token}" _RT_VALUE="${value}" python3 -c "
import os
from pathlib import Path
p = Path(os.environ['_RT_FILE'])
text = p.read_text()
text = text.replace(os.environ['_RT_TOKEN'], os.environ['_RT_VALUE'])
p.write_text(text)
"
}
