#!/usr/bin/env bash
set -euo pipefail

npm run package
vsce package
