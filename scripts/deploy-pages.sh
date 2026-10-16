#!/usr/bin/env bash
# Publish public/ to the gh-pages branch (GitHub Pages "Deploy from a branch" mode).
# Not needed once ci/workflows/pages.yml is installed as .github/workflows/pages.yml.
set -euo pipefail
cd "$(dirname "$0")/.."
git subtree split --prefix public -b gh-pages-tmp >/dev/null
git push origin gh-pages-tmp:gh-pages
git branch -D gh-pages-tmp >/dev/null
echo "Pushed public/ to gh-pages"
