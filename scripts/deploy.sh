#!/usr/bin/env bash
# Build and publish to GitHub Pages (the gh-pages branch of this repo).
#
#   npm run deploy
#
# Pages serves whatever is on gh-pages, so this rebuilds dist/ and force-pushes
# it there. It never touches main.
set -euo pipefail

REPO="https://github.com/krishmaheshwari-netizen/petals.git"
STAGE="$(mktemp -d)"

npm run build
cp -r dist/. "$STAGE/"
touch "$STAGE/.nojekyll"   # stop Pages running the output through Jekyll

cd "$STAGE"
git init -q
git add -A
git -c user.name="Krish Maheshwari" -c user.email="krish.maheshwari@yale.edu" \
    commit -q -m "Deploy Petals"
git -c credential.helper='!gh auth git-credential' push -q --force "$REPO" HEAD:gh-pages

rm -rf "$STAGE"
echo "Deployed → https://krishmaheshwari-netizen.github.io/petals/"
