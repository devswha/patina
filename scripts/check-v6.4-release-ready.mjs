import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STATE_URL = new URL('../docs/operations/v6.4-preflight-hold.json', import.meta.url);
const PACKAGE_URL = new URL('../package.json', import.meta.url);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isV64 = (version) => typeof version === 'string' && /^v?6\.4(?:\.|$)/.test(version);
const versionFromRef = (ref) => typeof ref === 'string' && ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : undefined;

/** Collect authorization failures for a release context without reading process state. */
export function collectReleaseReadyErrors(state, context = {}) {
  const isRelease = context.isRelease === true || (typeof context.ref === 'string' && context.ref.startsWith('refs/tags/'));
  if (!isRelease) return [];

  const versions = [context.version, versionFromRef(context.ref)].filter((version) => typeof version === 'string' && version.length > 0);
  if (versions.length === 0) return ['release target version is required'];
  if (!versions.some(isV64)) return [];

  if (!isObject(state)) return ['v6.4 release state is missing or malformed'];
  const errors = [];
  if (state.release !== 'v6.4') errors.push('v6.4 release state has an invalid release identifier');
  if (typeof state.state !== 'string') errors.push('v6.4 release state has an invalid state');
  else if (state.state === 'HOLD_NO_PROMOTION') errors.push('v6.4 release state is HOLD_NO_PROMOTION');
  if (!isObject(state.prohibitions)) errors.push('v6.4 release state has invalid prohibitions');
  else {
    for (const action of ['tag', 'publish']) {
      if (typeof state.prohibitions[action] !== 'boolean') errors.push(`v6.4 release state has an invalid ${action} prohibition`);
      else if (state.prohibitions[action]) errors.push(`v6.4 ${action} is prohibited`);
    }
  }
  return errors;
}

/** Run the pure collector with injectable release inputs. */
export function runReleaseReady({ state, context } = {}) {
  const errors = collectReleaseReadyErrors(state, context);
  return { ok: errors.length === 0, errors };
}

function checkedInContext(environment = process.env) {
  return {
    isRelease: environment.RELEASE_READY_CONTEXT === 'publish' || environment.GITHUB_EVENT_NAME === 'workflow_dispatch' || environment.GITHUB_REF?.startsWith('refs/tags/'),
    version: environment.npm_package_version ?? JSON.parse(readFileSync(PACKAGE_URL, 'utf8')).version,
    ref: environment.GITHUB_REF,
  };
}

export function checkCheckedInReleaseReady({ readState = () => readFileSync(STATE_URL, 'utf8'), context = checkedInContext() } = {}) {
  let state;
  try {
    state = JSON.parse(readState());
  } catch {
    state = undefined;
  }
  return runReleaseReady({ state, context });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkCheckedInReleaseReady();
  if (!result.ok) {
    console.error(result.errors.map((error) => `v6.4 release-ready: ${error}`).join('\n'));
    process.exitCode = 1;
  } else console.log('Release-ready guard passed.');
}
