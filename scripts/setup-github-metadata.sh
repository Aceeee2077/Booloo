#!/usr/bin/env bash
#
# One-shot repository metadata for GitHub growth.
#
# Sets the things a visitor sees *before* they open the README — the description
# in search results and social cards, the topics that make the repo findable,
# and Discussions (which the README links to).
#
#   ./scripts/setup-github-metadata.sh                 # edits Aceeee2077/Booloo
#   ./scripts/setup-github-metadata.sh OWNER/REPO      # or another fork
#
# Requires the GitHub CLI, authenticated with write access to the repository:
#
#   gh auth login          # or: gh auth status   to see where you stand
#
# It is idempotent — re-running it just re-applies the same values.

set -euo pipefail

REPO="${1:-${BOOLOO_REPO:-Aceeee2077/Booloo}}"

# Search results and social cards cut this off around 160 characters, so the
# useful words have to be at the front: what it is, what it is built with, and
# what makes it different.
DESCRIPTION="A tiny transparent desktop pet built with Tauri + Rust. Import any photo for local background removal, plus CPU/battery awareness and measurable companionship. No account, nothing uploaded."

# Topics are how the repository is found by people who are not already looking
# for it. GitHub allows 20; these are the ones that describe what Booloo really
# does. Lowercase, hyphens, no spaces.
TOPICS=(
  desktop-pet
  desktop-mascot
  tauri
  rust
  cross-platform
  windows
  macos
  linux
  desktop-app
  local-first
  privacy-first
  background-removal
  image-editing
  productivity
  cat
  pet
  open-source
)

# Deliberately NOT applied, although they are tempting search terms:
#
#   live2d, vrm  — Booloo renders sprite sheets and pose atlases on a Canvas.
#                  It cannot load Live2D or VRM models. Tagging it with them
#                  would bring in people looking for something the app does not
#                  do, which costs more in uninstalls and bad issues than the
#                  extra impressions are worth.
#
# If that ever changes, add the topic here *and* add it to the feature list in
# the READMEs in the same commit.

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is not installed: https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Not logged in to GitHub, so nothing was changed.

  1. gh auth login
  2. re-run this script

The token needs the `repo` scope (the default when gh asks about GitHub.com).
EOF
  exit 1
fi

echo "==> Repository: $REPO"

echo "==> Description"
gh repo edit "$REPO" --description "$DESCRIPTION"

echo "==> Topics"
for topic in "${TOPICS[@]}"; do
  gh repo edit "$REPO" --add-topic "$topic" >/dev/null
done
echo "    ${#TOPICS[@]} topics applied: ${TOPICS[*]}"

# Discussions is what the README points at for "share your pet" posts. Without
# this the link 404s.
echo "==> Discussions"
gh repo edit "$REPO" --enable-discussions

# ---------------------------------------------------------------------------
# Deliberately left alone
# ---------------------------------------------------------------------------
#
# --homepage
#   A repository homepage is a URL to a *project site*, and there is not one
#   yet. Pointing it at the Releases page would be filler. If a landing page
#   ever exists, set it with:
#       gh repo edit "$REPO" --homepage "https://example.com/booloo"
#
# --default-branch
#   The default branch is `Tauri2.0-version`, and `main` is the archived
#   Electron 0.4.0 snapshot. Renaming the default branch to `main` would help
#   newcomers, but it breaks every clone, PR and bookmarked URL pointing at the
#   current name, so it is a deliberate decision to make on its own:
#       gh repo edit "$REPO" --default-branch main
#
# Social preview image
#   Not settable through the API. Upload it by hand:
#   Settings → General → Social preview → Upload an image.
#   Use docs/screenshots/lightweight-pet.png (or a 1280×640 crop of it) so link
#   cards on Twitter/X, Slack and Discord show the pet instead of a grey box.

echo
echo "Done. Verify with:"
echo "  gh repo view $REPO --json description,repositoryTopics,hasDiscussionsEnabled"
