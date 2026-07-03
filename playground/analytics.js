/* global window */
// Intentional no-op analytics queue shim (kept deliberately unused by default).
//
// vercel.json rewrites /analytics.js to this file, and index.html does NOT load
// it: the playground performs no telemetry calls of its own. The shim exists so
// a deployment layer that injects Vercel Analytics (window.va) finds a
// same-origin queue instead of throwing. It must stay dependency-free, make no
// network requests, and never add external origins (CSP is self-only). Turning
// real telemetry on is a product decision — see playground/DESIGN.md §Analytics.
window.va = window.va || function queueVercelAnalytics(...args) {
  (window.vaq = window.vaq || []).push(args);
};
