# Wave 1 Codebase: Playground Runtime

## Key Findings

- The browser playground is synchronous and main-thread bound: `runAnalysis()` calls `analyzePlaygroundText()` directly on input events and re-renders all state.
- Core deterministic detectors are mostly shared from `src/features`; remaining playground logic is UI/report glue.
- The safest performance direction is a worker wrapper and/or debounce around `analyzePlaygroundText()`, preserving audit-only semantics.
- The lexicon browser bundle is currently small, but it is eager-loaded and generated from markdown lexicons, so growth directly increases initial parse/load cost.

## Sources

- `/home/devswha/workspace/patina/playground/app.js` lines 98-155: synchronous input-to-analysis path.
- `/home/devswha/workspace/patina/playground/analyzer.js` lines 1-664: browser analyzer, shared imports, UI helpers, false-positive URL builder.
- `/home/devswha/workspace/patina/playground/data/lexicons.js` lines 1-344: generated eager lexicon payload.
- `/home/devswha/workspace/patina/playground/README.md` lines 3-10 and 24-33: audit-only/static constraints and lexicon generation.
- `/home/devswha/workspace/patina/docs/integrations/playground.md` lines 9-16 and 28-35: user-facing audit-only contract.
- `/home/devswha/workspace/patina/tests/unit/playground.test.js` lines 374-398 and 833-845: advisory metadata and static graph constraints.

## EXPAND

- LEAD: `playground/app.js` reruns full analysis on every `input` event without debounce or worker offload — WHY: this is the dominant browser-thread cost on long pastes — ANGLE: inspect event frequency, add a worker boundary, and measure keystroke-to-render latency
- LEAD: `playground/analyzer.js` still owns UI-only rendering helpers plus analysis orchestration — WHY: this is where any accidental duplication or heavy synchronous work would hide — ANGLE: separate pure analysis from HTML generation and identify any functions safe to memoize or move off-thread
- LEAD: `playground/data/lexicons.js` is the only eager browser payload in this surface and is generated from markdown lexicons — WHY: bundle growth here directly impacts initial load and parse cost — ANGLE: compare generated size across commits and consider lazy language packs if payload growth keeps trending up
- LEAD: `tests/unit/playground.test.js` explicitly pins static-graph, audit-only, and parity behavior — WHY: these tests define the hard constraints for any optimization — ANGLE: trace which tests must stay green for a worker refactor and which ones prove no rewrite capability leaked in
