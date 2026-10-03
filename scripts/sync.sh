#!/usr/bin/env bash
# Keep the three copies of Pioneer in step: type-check, deploy to production,
# run the end-to-end check against production, then commit and push.
#   scripts/sync.sh "commit message"
set -euo pipefail
cd "$(dirname "$0")/.."
MSG="${1:-Sync}"
URL="https://pioneer-hive.vercel.app"

echo "== type-check"
pnpm exec tsc --noEmit

echo "== deploy"
pnpm dlx vercel@latest deploy --prod --yes 2>&1 | grep -E "Production URL|ready|Error|error TS|Failed|failed" | tail -5 || true

echo "== end-to-end on production"
node --env-file=.env.local scripts/e2e.mjs --url "$URL" | grep -E "FAIL|passed|Clean-up"

echo "== commit and push"
git add -A
if git diff --cached --quiet; then
  echo "nothing to commit"
else
  git commit -q -m "$MSG

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
  git push -q origin main
fi
git log --oneline | head -1
echo "== in sync: local $(git rev-parse --short HEAD), origin $(git rev-parse --short origin/main), live $URL"
