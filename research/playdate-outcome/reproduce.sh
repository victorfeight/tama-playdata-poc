#!/usr/bin/env bash
# Run from this isolated worktree's root. No merge, push, deploy or hardware I/O.
set -euo pipefail
test -f tama-protocol/src/playdate-outcome.ts
outcome_sdk=${OUTCOME_SDK:-/mnt/c/users/vic/paradise-scene-sdk}
outcome_node="$outcome_sdk/toolchains/node/bin/node"
outcome_python="$outcome_sdk/toolchains/python/bin/python"
outcome_evidence="$(mktemp -d /tmp/playdate-outcome-check.XXXXXX)"
export PATH="$outcome_sdk/toolchains/node/bin:$PATH"
export TAMA_GHOST_FIXTURE=/mnt/c/users/vic/tama-tools/TamaParadise-Licenses/CROSSPLATFORM_TAMA/BuiltinItems/Ghosts/ghost_kuchipatchi.bin
# Install workspace dependencies with pnpm first on a new machine. The original
# investigation reused local cached dependencies, with worktree-local package links.
"$outcome_node" node_modules/typescript/bin/tsc -p tama-protocol/tsconfig.json
"$outcome_node" node_modules/typescript/bin/tsc -p relay-server/tsconfig.json
"$outcome_node" node_modules/typescript/bin/tsc -p web-client/tsconfig.json
"$outcome_node" tama-protocol/node_modules/vitest/vitest.mjs run --root tama-protocol test/playdate-outcome.test.ts test/ghost-pipeline.test.ts test/ghost-render.test.ts --maxWorkers=1 --minWorkers=1
"$outcome_node" relay-server/node_modules/vitest/vitest.mjs run --root relay-server test/lobby.test.ts --maxWorkers=1 --minWorkers=1
"$outcome_node" web-client/node_modules/vite/bin/vite.js build web-client
"$outcome_python" research/playdate-outcome/native_contract.py --sdk "$outcome_sdk" --output "$outcome_evidence/native-contract.json"
"$outcome_python" research/playdate-outcome/breeding_contract.py --sdk "$outcome_sdk" --output "$outcome_evidence/breeding-contract.json"
"$outcome_sdk/toolchains/esbuild/esbuild" research/playdate-outcome/replay-captures.ts --bundle --platform=node --format=esm --outfile="$outcome_evidence/replay.mjs"
"$outcome_node" "$outcome_evidence/replay.mjs" "$outcome_sdk" "$outcome_evidence/capture-replay.json"
printf 'Fresh validation output: %s\n' "$outcome_evidence"
# Optional fresh full-native fault capture (do not overwrite retained evidence):
# "$outcome_python" research/playdate-outcome/capture_failure.py --sdk "$outcome_sdk" --output "$outcome_evidence/native-faults"
# Optional Ghidra regeneration using the existing mapped project:
# python3 "$outcome_sdk/tools/sdk.py" ghidra "$outcome_sdk/private/artifacts/normal-director-20261011" ghidra -process Glacier_clean.bin -noanalysis -readOnly -scriptPath "$outcome_sdk/src/AnimationLab" -postScript decompile_mapped.py "$PWD/research/playdate-outcome/breeding-targets.tsv" "$outcome_evidence/ghidra-breeding"
# Browser E2E requires separate localhost relay + Vite processes (stop afterward):
# PORT=3037 DB_PATH=/tmp/playdate-outcome-test.sqlite "$outcome_node" relay-server/node_modules/tsx/dist/cli.mjs relay-server/src/index.ts
# VITE_RELAY_URL=http://127.0.0.1:3037 "$outcome_node" web-client/node_modules/vite/bin/vite.js web-client --host 127.0.0.1 --port 5177 --strictPort
# PLAYWRIGHT_MODULE=/tmp/tama-games-browser/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/tama-games-browser/browsers LD_LIBRARY_PATH=/tmp/tama-games-browser/libraries/usr/lib/x86_64-linux-gnu "$outcome_node" scripts/test-playdate-lobby-browser.mjs http://127.0.0.1:5177 "$outcome_evidence/browser" http://127.0.0.1:3037
