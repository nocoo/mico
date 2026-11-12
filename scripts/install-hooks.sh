#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/pre-commit .githooks/pre-push
git config core.hooksPath .githooks
echo "hooks: core.hooksPath=$(git config core.hooksPath)"
