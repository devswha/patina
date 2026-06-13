# Wave 2: LLM Backend Optimization

Scope: official provider/runtime guidance for Patina's LLM-backed rewrite, score, diff, and ouroboros paths.

## Provider Findings

1. Prompt caching
   - OpenAI docs: https://developers.openai.com/api/docs/guides/prompt-caching
   - Anthropic docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   - Gemini docs: https://ai.google.dev/gemini-api/docs/caching
   - Patina fit: stable skill/profile/rubric/schema prefixes should come before dynamic user text. Existing API metadata should log cached token counts when providers expose them.

2. Structured outputs
   - OpenAI docs: https://developers.openai.com/api/docs/guides/structured-outputs
   - Gemini docs: https://ai.google.dev/gemini-api/docs/structured-output
   - Anthropic release notes: https://docs.anthropic.com/en/release-notes/api
   - Patina fit: `src/scoring.js` retries once after JSON parse/schema failures. Provider-native structured output can reduce that retry cost for compatible backends.
   - Caveat: support is not a lowest-common-denominator feature across local CLI backends and OpenAI-compatible providers.

3. Retry and timeout layering
   - `src/api.js` already retries retryable HTTP/network failures with exponential backoff.
   - `src/scoring.js` can add another full model call on JSON failure.
   - `src/backends/contract.js` adds backend timeouts and filesystem concurrency slots.
   - Provider SDKs and local CLIs may have their own retry/timeout behavior.
   - Recommendation: make retry ownership explicit per backend to avoid accidental retry multiplication.

4. Batch/offline workloads
   - OpenAI Batch: https://developers.openai.com/api/docs/guides/batch
   - Anthropic batch: https://docs.anthropic.com/en/docs/build-with-claude/batch-processing
   - Gemini Batch: https://ai.google.dev/gemini-api/docs/batch-api
   - Patina fit: corpus scoring, live-quality sweeps, and dogfood-like noninteractive jobs can use async batch modes if implemented per provider.

## Priority For Patina

1. Make prompt assembly cache-friendly.
2. Log cache and token metadata where available.
3. Add optional structured-output request mode for OpenAI HTTP first.
4. Do not apply provider batch/flex modes to interactive rewrite UX.
5. Keep deterministic analysis LLM-free.

