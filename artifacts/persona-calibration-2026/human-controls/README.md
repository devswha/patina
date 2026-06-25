# Human controls (false-positive negative set)

Genuinely human-written text used to measure patina's deterministic false-positive
(FP) behaviour — i.e. how often `analyzeText()` flags real human writing as AI.

## Status: SMOKE ONLY (n is too small for a hard gate)

The current set is **7 Korean blog/diary/review posts (2018–2019, pre-LLM)**. Seven
negatives cannot bound the true FP rate: even a perfect **0/7** result still leaves
a ~35% Wilson 95% upper bound. Therefore:

- This set is a **no-regression smoke ceiling and fixture seed only**.
- It MUST NOT be used as a hard FP CI threshold.
- It MUST NOT back any public FPR claim.
- `scripts/ai-tells-corpus-baseline.mjs` reports human-control FP with a Wilson
  interval and labels it smoke; raw bodies live in `raw/` (gitignored), so in CI
  they are absent and reported as `not_evaluated`.

## Files
| Path | Tracked | Contents |
|---|---|---|
| `{lang}.jsonl` (e.g. `ko.jsonl`) | ✓ | One metadata row per control: `{id, url, register, label:"human", year, char_count, sha256, source}`. No body text. The harness discovers every `human-controls/*.jsonl` and language-tags rows from the filename (a row may override with its own `lang`). |
| `raw/<id>.txt` | ✗ gitignored | The verbatim body used for local FP measurement. Never committed (copyright + the existing private-asset policy). |

## How the harness treats this set (exact current behaviour)

- **Discovery**: the harness reads every `human-controls/*.jsonl` (sorted), tagging
  each row's language from its filename (`ko.jsonl` → `ko`, `en.jsonl` → `en`)
  unless the row carries an explicit `lang`. Non-KO rows are scored with their own
  language and are excluded from the KO confusion slice.
- **Smoke / non-strict** (`node scripts/ai-tells-corpus-baseline.mjs`, no `--strict`):
  every discovered row is evaluated (when its `raw/<id>.txt` exists) and the
  human-control FP rate + Wilson interval are reported. Adding more rows/files is
  absorbed automatically here — no code change.
- **Strict** (`--strict`): an **exact-count drift guard**. It asserts the committed
  counts (currently `sycophancy=298`, `tells=85`, `human_controls=7`) and FAILS on
  any other count. Strict mode does **not** auto-absorb new controls — adding an 8th
  control (in any `{lang}.jsonl`) makes `--strict` fail until the contract is
  updated (see below).

## Expanding the negative set (required before any hard FP gate / public claim)

Before promoting human-control FP from smoke to a hard threshold or making any
public FPR statement, expand the set with provenance and slice diversity:

1. **Collect** additional clearly-human writing (pre-LLM where possible, plus
   recent human posts) across registers/domains and, ideally, languages. Reuse the
   existing intake path (`scripts/rebaseline-web-collect.mjs` and the
   `scripts/rebaseline-*` family) so provenance + sha256 handling stay consistent.
2. **Store** each body at `human-controls/raw/<id>.txt` (gitignored) and add one
   metadata row to the matching `human-controls/{lang}.jsonl` (create e.g. `en.jsonl`
   for English controls) with `label:"human"`, `url`, `sha256`, `register`, and
   `source`. Discovery picks the new file up automatically in smoke mode.
3. **Measure locally in smoke mode**: `node scripts/ai-tells-corpus-baseline.mjs`
   (no `--strict`) includes every discovered control and reports the FP rate +
   Wilson interval. `--strict` stays the committed 298/85/7 drift guard and will
   fail until step 4.
4. **Promote into the strict contract** (separate consensus): update
   `EXPECTED_COUNTS.human_controls` in `scripts/ai-tells-corpus-baseline.mjs` to the
   new committed total and re-run `--strict`. Only once the negative set is large
   enough that the Wilson upper bound is acceptable may Phase D turn the FP ceiling
   into a blocking threshold. Until then it stays report-only.

## Privacy
Raw bodies and any derived rewrites/comparison HTML are never committed; only
metadata + sha256 + source URL are tracked. `npm run check:no-private-assets`
guards the package/tracked surface.
