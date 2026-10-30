#!/usr/bin/env bash
# Package the already checked frontend; never rebuild on the ECS.
set -euo pipefail
SHA=${1:?Full checked commit SHA required}
RUN_ID=${2:?Verification run ID required}
OUTPUT=${3:?Absolute output directory required}
[[ $SHA =~ ^[a-f0-9]{40}$ && $RUN_ID =~ ^[1-9][0-9]*$ && $OUTPUT == /* ]]
[[ $(git rev-parse HEAD) == "$SHA" && $(node -p 'process.platform') == linux && $(node -p 'process.versions.node.split(".")[0]') == 24 ]]
node --input-type=module -e 'import fs from "node:fs"; if(JSON.parse(fs.readFileSync("dist/build-info.json")).revision!==process.argv[1])throw Error("Frontend does not match checked commit");' "$SHA"
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
cp package.json package-lock.json "$WORK/"
cp -R dist src worker server "$WORK/"
npm ci --omit=dev --ignore-scripts --prefix "$WORK"
node --input-type=module -e 'import fs from "node:fs";fs.writeFileSync(process.argv[1],JSON.stringify({schema:1,repository:"qiuh23/wizard-friends",commit:process.argv[2],runId:Number(process.argv[3]),platform:process.platform,arch:process.arch,nodeMajor:24,stateSchema:1}));' "$WORK/release.json" "$SHA" "$RUN_ID"
mkdir -p -- "$OUTPUT"
tar -czf "$OUTPUT/wizard.tar.gz" -C "$WORK" dist src worker server node_modules package.json package-lock.json release.json
(cd -- "$OUTPUT" && sha256sum wizard.tar.gz > wizard.tar.gz.sha256)
