#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -x node_modules/.bin/dsh || ! -x node_modules/.bin/tsc ]]; then
    npm ci --prefix "$PWD"
fi
npm run build
exec ./node_modules/.bin/dsh web --patch "$PWD/cordis.patch.yml" "$@"
