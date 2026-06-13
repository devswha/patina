// Web Worker entry: runs the deterministic playground analysis off the main
// thread so a long paste never blocks UI rendering. app.js loads this via
// `new URL('./analyzer-worker.js', import.meta.url)` so the path stays relative
// and works under static hosting (patina.vibetip.help). Browser-pure: no node:
// imports, no detector behavior — just the shared analyzer + dispatch glue.
import { analyzePlaygroundText } from './analyzer.js';
import { handleAnalysisRequest } from './analysis-dispatch.js';

globalThis.onmessage = (event) => {
  const response = handleAnalysisRequest(event.data, analyzePlaygroundText);
  globalThis.postMessage(response);
};
