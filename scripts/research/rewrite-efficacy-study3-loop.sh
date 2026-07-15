#!/usr/bin/env bash
# Study 3 overnight supervisor: run the (resumable) runner until all 54 rows
# are clean. Between passes, prune fail-soft rows (rewrite_error / missing
# rewrite3_sha) so they retry — the S2 execution practice, automated. Backs
# off 30 min between passes to ride out claude 5h-window exhaustion.
set -u
cd "$(dirname "$0")/../.."
ROWS=artifacts/rewrite-efficacy-study3/s3-rows-D3.jsonl
LOG=artifacts/rewrite-efficacy-study3/s3-run.log

for pass in $(seq 1 48); do
  echo "[loop] pass $pass" >> "$LOG"
  node scripts/research/rewrite-efficacy-study3.mjs
  # prune fail-soft rows so resume retries them
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    if (!fs.existsSync(p)) process.exit(0);
    const rows = fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map(JSON.parse);
    const good = rows.filter((r) => !r.rewrite_error && r.rewrite3_sha);
    if (good.length !== rows.length) {
      fs.writeFileSync(p, good.map((r) => JSON.stringify(r)).join("\n") + (good.length ? "\n" : ""));
      console.log(`[loop] pruned ${rows.length - good.length} fail-soft rows`);
    }
    process.exit(rows.length === 54 && good.length === 54 ? 42 : 0);
  ' "$ROWS" >> "$LOG" 2>&1
  if [ $? -eq 42 ]; then echo "[loop] all 54 rows clean — done" >> "$LOG"; exit 0; fi
  echo "[loop] incomplete after pass $pass — sleeping 30m before resume" >> "$LOG"
  sleep 1800
done
echo "[loop] gave up after 12 passes" >> "$LOG"
exit 1
