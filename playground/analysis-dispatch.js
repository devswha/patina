// Pure analysis-dispatch protocol for the playground.
//
// This module has NO DOM and NO Worker globals, so it is safe to unit-test in
// node. `app.js` wires the real Worker + render(); `analyzer-worker.js` wires
// handleAnalysisRequest. Keeping the monotonic-request-id, stale-rejection, and
// worker-fallback logic here makes that protocol testable without a browser.

// Worker side: turn an analysis request message into a response. Pure.
// Exchanges only structured-clone-safe data: requestId, text, lang, result.
export function handleAnalysisRequest(message, analyze) {
  const { requestId, text, lang } = message ?? {};
  return { requestId, analysis: analyze(text ?? '', { lang }) };
}

// Main-thread controller. Dependencies are injected so this is fully testable:
//   analyze(text, { lang })  -> synchronous deterministic analysis (fallback).
//   createWorker()           -> a Worker-like object, or null; may throw.
//   onResult(analysis, id)   -> apply the freshest analysis to the UI.
//   onError(error)           -> optional notification when the worker dies.
//
// Guarantees:
//   * request ids are monotonic increasing;
//   * only the latest request id is applied (stale worker responses dropped);
//   * any worker construction / postMessage / runtime error permanently falls
//     back to synchronous same-thread analysis (no lost or duplicated render).
export function createAnalysisController({ analyze, createWorker, onResult, onError } = {}) {
  if (typeof analyze !== 'function') {
    throw new TypeError('createAnalysisController requires an analyze() function');
  }

  let worker = null;
  let workerDisabled = false;
  let counter = 0;
  let latestId = 0;
  let lastRequest = null;
  let pendingId = 0; // latest request awaiting a worker response (0 = none).

  function disableWorker(error) {
    workerDisabled = true;
    const dead = worker;
    worker = null;
    if (dead && typeof dead.terminate === 'function') {
      try {
        dead.terminate();
      } catch {
        // A worker that throws on terminate is already gone; ignore.
      }
    }
    if (error !== undefined) onError?.(error);
  }

  function ensureWorker() {
    if (workerDisabled) return null;
    if (worker) return worker;
    if (typeof createWorker !== 'function') {
      workerDisabled = true;
      return null;
    }
    let created;
    try {
      created = createWorker();
    } catch (error) {
      disableWorker(error);
      return null;
    }
    if (!created) {
      workerDisabled = true;
      return null;
    }
    created.onmessage = (event) => {
      const data = event && typeof event === 'object' && 'data' in event ? event.data : event;
      // Drop stale or unrecognized responses; only the latest request renders.
      if (!data || data.requestId !== latestId) return;
      pendingId = 0; // latest request is now fulfilled by the worker.
      onResult?.(data.analysis, data.requestId);
    };
    created.onerror = (error) => {
      disableWorker(error);
      // Recover ONLY a still-in-flight latest request, so a worker that dies
      // after already answering the latest request can never render twice.
      if (pendingId !== 0 && pendingId === latestId && lastRequest && lastRequest.requestId === pendingId) {
        runSameThread(lastRequest.text, lastRequest.lang, lastRequest.requestId);
      }
    };
    worker = created;
    return worker;
  }

  function runSameThread(text, lang, requestId) {
    const analysis = analyze(text, { lang });
    if (requestId === latestId) {
      pendingId = 0; // this request is fully resolved on the main thread.
      onResult?.(analysis, requestId);
    }
    return { requestId, mode: 'sync', analysis };
  }

  function request(text, lang) {
    counter += 1;
    const requestId = counter;
    latestId = requestId;
    lastRequest = { text, lang, requestId };
    const active = ensureWorker();
    if (!active) return runSameThread(text, lang, requestId);
    try {
      active.postMessage({ requestId, text, lang });
    } catch (error) {
      disableWorker(error);
      return runSameThread(text, lang, requestId);
    }
    pendingId = requestId; // worker accepted the post; await its response.
    return { requestId, mode: 'worker' };
  }

  return {
    request,
    isStale: (id) => id !== latestId,
    get latestId() {
      return latestId;
    },
    get usingWorker() {
      return Boolean(worker) && !workerDisabled;
    },
  };
}
