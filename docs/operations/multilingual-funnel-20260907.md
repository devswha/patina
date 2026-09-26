# Multilingual funnel measurement — September 7, 2026

The browser sends category-only milestones after initialization. Prepared links
select the matching UI language. The implementation tests used local stores,
and this record does not claim production counts or external publication.

## Existing coverage and the measured gap

`playground/analytics.js` already sends categorical input, rewrite request,
completion, failure, result-action, checkout-start and tier-selection events.
`src/funnel-analytics.js` validates exact schemas; `api/funnel.js` stores daily
aggregate counters. Those events and their keys remain compatible.

At base `0133dd8`, `captureUtm()` in `playground/chatgpt.js` holds sanitized
checkout parameters in memory and forwards them to checkout links. Its
character/entropy filter permits values outside a finite campaign list. It
does not measure acquisition. Do not pass `capturedUtm` to analytics.

The old completion `mode=first` means the request mode, not the first success
on a page. Input-start counts omit people who never type and may count both
hero and chat. Neither supplies an arrival denominator or a reuse count.

One compact `Funnel Progress` event fills these gaps. Its data is exactly
`{lang, channel, campaign, stage}`. Acquisition dimensions do not multiply
the existing detailed rewrite counters. The API handler needs no change:
its existing validator accepts the added schema and applies the same budget.

## UI integration

At the end of successful initialization in `playground/chatgpt.js`, after
language selection, `onLangChange()`, `newConvo()`, `showLanding()` and the
send-control updates, add this single call:

```js
globalThis.patinaFunnelReady?.(els.lang.value);
```

Honor the share link's `lang` with an exact `ko/en/zh/ja` allowlist before
initializing the UI. Base `0133dd8` always selects English; the analytics
adapter deliberately does not treat a URL language as proof of UI language.
The UI controller owns that language-routing choice. Call readiness after the UI
has actually initialized, not when the analytics script loads or a module
starts importing. Repeated readiness calls are harmless and do not reset it.

Keep the existing terminal call, once per approved attempt:

```js
track('Rewrite Completed', {
  ...telemetry,
  latencyBucket: latencyBucket(startedAt),
  mpsBand: scoreBand(mps),
  fidelityBand: scoreBand(fidelity),
});
```

The existing `terminalTracked` guard deduplicates this call. No additional
success/reuse call is needed. The adapter derives both milestones from valid
completions whose MPS and fidelity bands are not `failed`. Do not emit
`Funnel Progress` directly or replay completion events when rendering history.
Errors, cancellation, input, copy/download/export/audit, checkout clicks and
requests do not advance the milestone state.

Integration checks must verify initialization in all four languages, one arrival
after readiness, no success after a rejected rewrite, and exactly one reuse
milestone after the second accepted result. Changing language or starting a
new conversation in the same page must not reset the funnel.

## Counts and denominators

All three stages use the language and safe acquisition labels captured at
readiness. Subsequent language changes still belong to that arrival group;
the legacy rewrite events continue to report the actual request language.

| Stage | Count represented within one loaded page |
| --- | --- |
| `arrival` (A) | One UI initialization with a supported language |
| `first-success` (F) | One first successful rewrite after initialization |
| `reuse` (R) | One second successful rewrite after initialization |

Report first-success rate as F/A, reuse among successful pages as R/F, and
arrival-to-reuse as R/A, always with the counts and selected period. A zero
or unavailable denominator means the rate is unavailable. These are observed
page milestones, not unique people. R measures pages with at least two
successes; it does not count every repeat rewrite. Third and later successes
still emit the existing `Rewrite Completed` event, but no new milestone.

First, refine and verify modes can all produce accepted results. Two successful
attempts in one conversation qualify as reuse, as do attempts in separate
conversations within the page. Failures before or between them do not qualify.
The adapter depends on the UI's terminal-event guard: it has no request IDs
with which to independently deduplicate arbitrary duplicate completion calls.

A reload or new tab starts fresh. A page restored from browser back/forward
cache retains its in-memory state. No cross-visit retention, returning-user
rate or cross-device attribution can be claimed. There are no session IDs,
cookies, storage entries or fingerprints in this measurement.

Daily keys use the server's UTC event date, not an arrival cohort date. A page
can arrive before midnight and succeed after midnight, so daily F/A and R/F
are activity-window ratios, not linked cohort conversions; they may exceed
100%. Wider windows reduce this boundary effect but do not remove it.

Transport loss, browser blocking, malformed events, absent configuration,
storage failures and the shared daily budget can drop any stage separately.
There is no retry queue, delivery acknowledgment gate or reconciliation. An
unobserved counter does not prove zero activity. The endpoint accepts
categories, not evidence of a human, so automated or forged same-origin
requests can also skew counts.

GitHub star conversion cannot be inferred from these events. Even a GitHub
link click would not establish a star. Checkout-start counts do not establish
payment. The separate provider-confirmed purchase counter has no per-page
join and cannot attribute a purchase or a star to one of these arrivals.

## Finite attribution and prepared links

Only exact decoded `utm_source` values `github`, `blog`, `social`,
`community`, or the fallback `unattributed` become `channel`. Only
`multilingual-20260907` or the fallback `none` become `campaign`. Each field
maps independently. Missing, unknown, empty or duplicated parameters map to
its fallback. Case changes and trailing whitespace are not normalized.
Queries longer than 4096 characters, or inaccessible query strings, use both
fallbacks. Only the safe categories survive parsing in memory.

UTM medium/content/term, `ref`, arbitrary query fields, path, full URL,
fragment and raw referrer are never sent or stored by this adapter. Do not
put draft text, credentials, email, handles or identifiers into share links.
The existing checkout UTM behavior is a separate path and is unchanged here.

These four community links are prepared for introduction drafts:

| Copy language | Prepared link |
| --- | --- |
| KO | `https://patina.vibetip.help/?lang=ko&utm_source=community&utm_campaign=multilingual-20260907` |
| EN | `https://patina.vibetip.help/?lang=en&utm_source=community&utm_campaign=multilingual-20260907` |
| ZH | `https://patina.vibetip.help/?lang=zh&utm_source=community&utm_campaign=multilingual-20260907` |
| JA | `https://patina.vibetip.help/?lang=ja&utm_source=community&utm_campaign=multilingual-20260907` |

For GitHub, blog or social copy, replace only `utm_source=community` with
`utm_source=github`, `utm_source=blog` or `utm_source=social`, respectively.
That defines 16 tagged links across four languages and four channels, with
one fixed campaign. Unknown future campaigns collapse to `none` until a
reviewed client/server allowlist change; never add per-post identifiers.
The UI language routing must remain compatible with these links. Drafting a
link or introduction does not itself publish a post.

## Storage, budget and privacy boundaries

The new schema admits at most 4 languages × 5 channels × 2 campaigns ×
3 stages = **120 additional keys per UTC day**. A loaded page generates at
most three additional requests. The existing UTC-day budget is shared with
all browser funnel events: default 10,000 requests accepted for counters per
day, configurable through `PATINA_FUNNEL_EVENTS_PER_DAY` from 1 to 1,000,000.
The atomic store operation increments the budget before checking the limit,
so the budget value includes rejected over-limit attempts that reach it;
it is not the number of successful rewrites or stored events.

Each counter and the daily budget expire 35 days after their last increment.
The added milestone namespace therefore spans at most 36 UTC date buckets
at once (4,320 possible keys), assuming a normally advancing server clock.
The API makes one aggregate increment per valid request and never persists
the body or request context. Its 4 KiB body limit, same-origin/deployment-host
checks, 429 budget response, and 503 response on missing/unusable storage
remain in force. Intake has no aggregate-read route.

The browser posts only to `/api/funnel` with `credentials: 'omit'` and
`referrerPolicy: 'no-referrer'`. No text, output, key, IP, ID, raw UTM, raw
referrer or URL becomes a dimension. HTTP infrastructure necessarily handles
connections and headers; these tests establish the application payload and
KV boundary, not an audit of hosting-provider access logs.

## Aggregate query with existing tooling

Use Node's built-in fetch and the existing observability Upstash REST store,
from the repository root. Supply `PATINA_OBSERVABILITY_REST_API_URL` and
`PATINA_OBSERVABILITY_REST_API_TOKEN` through the operator's existing trusted
environment. Never print them, paste them in this document, pass them as
command arguments, or enable shell tracing. This recipe does not obtain or
change credentials. It was tested against a mocked store, not production.

This read-only command enumerates all 120 known milestone keys and the single
budget key for one explicit UTC date in one `MGET`. It never scans unrelated
keys or reads identity, quota, payment-deduplication or log records. It prints
only fixed categorical labels, the selected date, counts and missingness;
errors use a fixed message without response bodies or authorization details.

```bash
FUNNEL_DAY=2026-09-07 node --input-type=module <<'NODE'
import { FUNNEL_PROGRESS_SCHEMA as schema, funnelCounterKey } from './src/funnel-analytics.js';
import { createFunnelAggregateStore } from './api/funnel.js';

try {
  const day = process.env.FUNNEL_DAY;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || new Date(day).toISOString().slice(0, 10) !== day) throw new Error('date');
  if (!createFunnelAggregateStore(process.env)) throw new Error('configuration');
  const rows = [];
  const keys = [];
  for (const lang of schema.lang) for (const channel of schema.channel) for (const campaign of schema.campaign) {
    rows.push({ lang, channel, campaign });
    for (const stage of schema.stage) {
      keys.push(funnelCounterKey({ name: 'Funnel Progress', data: { lang, channel, campaign, stage } }, day));
    }
  }
  keys.push(`patina:funnel:v1:${day}:budget`);
  const response = await fetch(new URL(process.env.PATINA_OBSERVABILITY_REST_API_URL).origin, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${process.env.PATINA_OBSERVABILITY_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['MGET', ...keys]),
  });
  if (!response.ok) throw new Error('query');
  const result = (await response.json()).result;
  if (!Array.isArray(result) || result.length !== keys.length) throw new Error('shape');
  const counts = result.map((value) => {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('count');
    const count = Number(value);
    if (!Number.isSafeInteger(count)) throw new Error('count');
    return count;
  });
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < schema.stage.length; j++) rows[i][schema.stage[j]] = counts[i * schema.stage.length + j];
  }
  console.log(JSON.stringify({ day, budget: counts.at(-1), observedMilestoneKeys: counts.slice(0, -1).filter((n) => n !== null).length, rows }, null, 2));
} catch {
  console.error('Funnel aggregate query unavailable; no counts reported.');
  process.exitCode = 1;
}
NODE
```

`null` means the key is absent, not a verified zero. An entirely absent day
can mean no arrivals, expired counters, missing UI integration, a deployment
without this code, unavailable storage, or the wrong environment. The
separate log-query service counts HTTP outcomes; it cannot recover these
milestones from request logs or infer their missing denominators.

## Verification

Run `node --test tests/unit/funnel-analytics.test.js
tests/unit/playground-analytics.test.js` as one command. Tests cover all 120
client/server combinations, once-per-page progress, language changes,
failures, unknown/duplicate UTMs, sensitive-data canaries, unchanged legacy
contracts, UTC boundaries, budget sharing, and storage failures.
The integrated UI must pass its browser checks before deployment.

Local verification on September 7: the 30 focused tests passed, and `npm test`
passed 2,239 tests with two skipped and no failures. Full `npm run lint`
passed. The final prose gate was 10.3%, below 30%. Dependencies were installed with
`npm ci --ignore-scripts --no-audit --no-fund`; no dependency or lockfile changed.
Model-backed example verification is recorded separately; it is not a
prerequisite for collecting these categorical events.
