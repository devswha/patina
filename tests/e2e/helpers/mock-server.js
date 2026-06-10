// Shared in-process mock of an OpenAI-compatible chat-completions endpoint for
// e2e tests. Listening on an ephemeral 127.0.0.1 port works for both in-process
// main() calls and spawned CLI subprocesses, so no stdout port handshake is
// needed (the `node -e` subprocess variant raced on split stdout writes).
import { createServer } from 'node:http';

/**
 * Start the mock server and resolve with a handle once it is listening.
 *
 * @param {string|Array<{responseText: string, statusCode?: number, extraResponse?: object}>} responseText
 *   Single response body, or a queue of per-request responses.
 * @param {number} [statusCode=200] Status code for the single-response form.
 * @param {object} [extraResponse={}] Extra JSON fields for the single-response form.
 * @returns {Promise<{
 *   port: number,
 *   callCount: number,
 *   lastRequestBody: object|null,
 *   lastAuthorization: string|null,
 *   requestBodies: object[],
 *   stop: () => Promise<void>,
 * }>} Mutable handle exposing captured request state.
 */
export function startMockServer(responseText, statusCode = 200, extraResponse = {}) {
  const queue = Array.isArray(responseText)
    ? responseText.map((entry) => ({
        responseText: entry.responseText,
        statusCode: entry.statusCode ?? 200,
        extraResponse: entry.extraResponse ?? {},
      }))
    : null;

  const handle = {
    port: null,
    callCount: 0,
    lastRequestBody: null,
    lastAuthorization: null,
    requestBodies: [],
    stop() {
      return new Promise((resolve) => {
        server.close(resolve);
      });
    },
  };

  const server = createServer((req, res) => {
    handle.callCount++;
    handle.lastAuthorization = req.headers.authorization || null;
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      handle.lastRequestBody = JSON.parse(body);
      handle.requestBodies.push(handle.lastRequestBody);
      const current = queue ? (queue.shift() || { responseText: '', statusCode: 200, extraResponse: {} }) : {
        responseText,
        statusCode,
        extraResponse,
      };
      res.writeHead(current.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: current.responseText } }],
        ...current.extraResponse,
      }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      handle.port = server.address().port;
      resolve(handle);
    });
  });
}
