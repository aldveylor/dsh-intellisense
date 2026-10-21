#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -x node_modules/.bin/dsh || ! -x node_modules/.bin/tsc ]]; then
    npm ci --prefix "$PWD"
fi
npm run build
mkdir -p build
node --input-type=module - <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const patch = readFileSync('cordis.patch.yml', 'utf8').replace('name: dsh-ts-intellisense', `name: ${JSON.stringify(resolve('dist/index.js'))}`);
writeFileSync('build/run.patch.yml', patch);
JS
exec ./node_modules/.bin/dsh web --patch "$PWD/build/run.patch.yml" "$@"
