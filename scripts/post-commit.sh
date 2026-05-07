#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# post-commit.sh  —  deploy to gh-pages on every commit to main
#
# Stored in scripts/ so it's version-controlled.
# Installed into .git/hooks/ by:  npm run setup  (or bash scripts/install-hooks.sh)
# ─────────────────────────────────────────────────────────────────────────────

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)

# Only deploy from main — skip feature branches, gh-pages itself, etc.
if [[ "$BRANCH" != "main" ]]; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel)

echo ""
echo "→ post-commit hook: deploying to gh-pages…"
bash "$REPO_ROOT/scripts/git-sync.sh" deploy
