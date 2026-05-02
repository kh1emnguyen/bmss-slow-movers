#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# git-sync.sh  —  push / pull / deploy the BMSS Slow Movers app
#
# Usage:
#   ./scripts/git-sync.sh push [message]   # commit everything and push to main
#   ./scripts/git-sync.sh pull             # pull latest from main
#   ./scripts/git-sync.sh deploy           # build → force-push dist/ to gh-pages
#
# Requires:
#   config.json (gitignored) at the repo root — copy from config.json.example
#   git, node/npm (for deploy)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Load config ───────────────────────────────────────────────────────────────
# Validate JSON before reading — catches missing file, typos, or corruption
python3 -c "
import json, sys
try:
    json.load(open('config.json'))
except FileNotFoundError:
    print('ERROR: config.json not found. Copy config.json.example -> config.json and fill in your token.', file=sys.stderr)
    sys.exit(1)
except json.JSONDecodeError as e:
    print(f'ERROR: config.json is not valid JSON: {e}', file=sys.stderr)
    print('Expected format:', file=sys.stderr)
    print(open('config.json.example').read(), file=sys.stderr)
    sys.exit(1)
" || exit 1

REPO=$(python3   -c "import json; print(json.load(open('config.json'))['repo'])")
BRANCH=$(python3 -c "import json; print(json.load(open('config.json'))['branch'])")
TOKEN=$(python3  -c "import json; print(json.load(open('config.json'))['token'])")

REMOTE_URL="https://${TOKEN}@github.com/${REPO}.git"

# ── Locate npm (handles Windows Git Bash where npm lives as npm.cmd) ──────────
find_npm() {
  # 1. Plain npm on PATH (Linux / macOS / WSL)
  if command -v npm &>/dev/null; then echo "npm"; return; fi
  # 2. npm.cmd on PATH (Git Bash with Node in PATH)
  if command -v npm.cmd &>/dev/null; then echo "npm.cmd"; return; fi
  # 3. Common Windows Node install locations
  for candidate in \
      "/c/Program Files/nodejs/npm.cmd" \
      "/c/Program Files (x86)/nodejs/npm.cmd" \
      "${APPDATA}/npm/npm.cmd" \
      "${LOCALAPPDATA}/nvm/npm.cmd" \
      "${LOCALAPPDATA}/Programs/nodejs/npm.cmd"; do
    [[ -f "$candidate" ]] && { echo "$candidate"; return; }
  done
  echo ""
}

NPM=$(find_npm)
if [[ -z "$NPM" ]]; then
  echo "ERROR: npm not found. Install Node.js from https://nodejs.org and restart Git Bash." >&2
  exit 1
fi

COMMAND="${1:-}"

case "$COMMAND" in

  # ── push ──────────────────────────────────────────────────────────────────
  push)
    MSG="${2:-"chore: sync $(date '+%Y-%m-%d %H:%M')"}"
    echo "→ Staging all changes..."
    git add -A
    if git diff --cached --quiet; then
      echo "Nothing to commit — working tree clean."
    else
      git commit -m "$MSG"
      echo "→ Pushing to $REPO ($BRANCH)..."
      git push "$REMOTE_URL" HEAD:"$BRANCH"
      echo "✓ Pushed."
    fi
    ;;

  # ── pull ──────────────────────────────────────────────────────────────────
  pull)
    echo "→ Pulling from $REPO ($BRANCH)..."
    git pull "$REMOTE_URL" "$BRANCH"
    echo "✓ Pulled."
    ;;

  # ── deploy ────────────────────────────────────────────────────────────────
  deploy)
    echo "→ Installing dependencies (using: $NPM)..."
    "$NPM" ci --silent
    echo "→ Building for production..."
    "$NPM" run build
    echo "→ Force-pushing dist/ to gh-pages branch..."
    # Stage dist/ then extract just that subtree as a standalone commit
    git add dist/ -f
    TREE=$(git write-tree --prefix=dist/)
    COMMIT=$(git commit-tree "$TREE" -m "deploy: $(date '+%Y-%m-%d %H:%M')")
    git push "$REMOTE_URL" "$COMMIT:refs/heads/gh-pages" --force
    echo "✓ Deployed → https://kh1emnguyen.github.io/bmss-slow-movers/"
    echo ""
    echo "  If this is your first deploy, go to:"
    echo "  GitHub → repo Settings → Pages → Source → gh-pages branch → / (root) → Save"
    ;;

  *)
    echo "Usage: $0 {push [message] | pull | deploy}" >&2
    exit 1
    ;;
esac
