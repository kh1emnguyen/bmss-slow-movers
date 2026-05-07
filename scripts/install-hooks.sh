#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-hooks.sh  —  copy post-commit.sh into .git/hooks/
#
# Run once after cloning:  npm run setup
# Safe to re-run; just overwrites the existing hook.
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOOK_SRC="$SCRIPT_DIR/post-commit.sh"
HOOK_DST="$REPO_ROOT/.git/hooks/post-commit"

if [[ ! -d "$REPO_ROOT/.git" ]]; then
  echo "ERROR: .git directory not found. Run this from inside the repo." >&2
  exit 1
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"

echo "✓ post-commit hook installed → .git/hooks/post-commit"
echo "  Every commit on main will now auto-deploy to gh-pages."
