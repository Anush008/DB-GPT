#!/usr/bin/env bash
# profiles.sh - Profile definitions for DB-GPT installer
#
# Each profile maps to:
#   1. A set of uv extras (fed to `uv sync --extra ...`)
#   2. A config template under templates/
#   3. The official config file path in the repo (for reference)

# ── Validation ────────────────────────────────────────────────────────────────

# Currently supported profiles.  Extend this list when adding new profiles.
readonly SUPPORTED_PROFILES="openai"

validate_profile() {
  local profile="$1"
  case "${profile}" in
    openai) ;;
    *)
      die "Unsupported profile: ${profile}. Supported profiles: ${SUPPORTED_PROFILES}"
      ;;
  esac
}

# ── Extras mapping ────────────────────────────────────────────────────────────
# Returns newline-separated extras for the given profile.
# These are taken directly from install_help.py / get_deployment_presets().

profile_extras() {
  local profile="$1"
  case "${profile}" in
    openai)
      cat <<'EOF'
base
proxy_openai
rag
storage_chromadb
dbgpts
EOF
      ;;
    *)
      die "No extras defined for profile: ${profile}"
      ;;
  esac
}

# ── Config template name ──────────────────────────────────────────────────────
# Returns the template filename (relative to templates/ dir).

profile_template() {
  local profile="$1"
  case "${profile}" in
    openai)  echo "openai.toml" ;;
    *)       die "No template defined for profile: ${profile}" ;;
  esac
}

# ── Repo config path (for display / fallback) ────────────────────────────────

profile_repo_config() {
  local profile="$1"
  case "${profile}" in
    openai)  echo "configs/dbgpt-proxy-openai.toml" ;;
    *)       die "No repo config path defined for profile: ${profile}" ;;
  esac
}

# ── Environment variable name for API key ─────────────────────────────────────

profile_api_key_env() {
  local profile="$1"
  case "${profile}" in
    openai)   echo "OPENAI_API_KEY" ;;
    *)        echo "" ;;
  esac
}

# ── Placeholder token in config template ──────────────────────────────────────

profile_api_key_token() {
  local profile="$1"
  case "${profile}" in
    openai)   echo "__OPENAI_API_KEY__" ;;
    *)        echo "" ;;
  esac
}
