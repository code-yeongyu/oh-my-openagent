#!/bin/bash
set -e
cd /Users/yeongyu/local-workspaces/oh-my-opencode

echo "=== Pushing to origin ==="
git push -f origin master

echo "=== Triggering workflow ==="
gh workflow run publish.yml --repo code-yeongyu/oh-my-opencode --ref master -f bump=patch -f version=$1

echo "=== Done! ==="
echo "Usage: ./local-ignore/push-and-release.sh 0.1.6"
