#!/usr/bin/env bash
# Puts <content dir> as the whole tree of a new commit on <branch>, tags it and pushes both
# (design §13.1, L9.3, L9.4). Each release is one commit on top of the previous one, so every
# tag stays reachable. Run from a full clone of the repository.
# Usage: scripts/release/publish-branch.sh <branch> <tag> <content dir> <commit message> [--tag-only]
# --tag-only (prereleases, L8.5): the commit is tagged and pushed, the branch head does not move.
set -euo pipefail

branch=$1
tag=$2
content=$(cd "$3" && pwd)
message=$4
tag_only=${5:-}

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  git fetch --quiet origin "$branch"
  git switch --quiet -C "$branch" "origin/$branch"
  git rm -rq --ignore-unmatch .
else
  git switch --quiet --orphan "$branch"
fi
git clean -fdq
cp -R "$content"/. .
git add -A
git commit --quiet -m "$message"
git tag "$tag"
if [ "$tag_only" = "--tag-only" ]; then
  git push --quiet origin "$tag"
  echo "pushed $tag at $(git rev-parse HEAD); $branch unchanged"
else
  git push --quiet origin "$branch" "$tag"
  echo "pushed $branch and $tag at $(git rev-parse HEAD)"
fi
