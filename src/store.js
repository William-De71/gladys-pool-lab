// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/pool-lab.json (mode 0600):
//
//   - `token`         a short SHA-256 of the API token the data was read with
//                     (never the token itself): another token, another start;
//   - `cloudId`       the id of the LabCom cloud account;
//   - `lastChangeAt`  its last change time, as LabCom gives it (diagnostic);
//   - `pools`         per account: its details and its measurements
//                     (pools.js: the last 300 of 400 days per parameter, and
//                     always the last one);
//   - `readAt`, `windowAt`, `triedAt`  when the last reading, the last
//                     400-day reading, the last attempt happened;
//   - `specs`         per account and parameter: the spec of its feature,
//                     frozen the first time it was offered (parameters.js);
//   - `seen`          per account: what the scene triggers know;
//   - `accessRefused` why LabCom refuses the token, or null (the trigger
//                     fires once per refusal);
//   - `lastError`     the last error of a reading (diagnostic).
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'pool-lab.json';
const EMPTY = () => ({
  token: null,
  cloudId: null,
  lastChangeAt: null,
  pools: {},
  readAt: 0,
  windowAt: 0,
  triedAt: 0,
  specs: {},
  seen: {},
  accessRefused: null,
  lastError: null,
});

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a
 * rename), readable by its owner only: it holds the measurements of the
 * account.
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isMeasurement = (m) =>
  isObject(m) &&
  Number.isInteger(m.id) &&
  Number.isInteger(m.parameterId) &&
  Number.isFinite(m.at) &&
  typeof m.status === 'string';

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save, path }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    path,
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const number = (value) => (Number.isFinite(value) ? value : 0);
      store.data.token = typeof raw.token === 'string' ? raw.token : null;
      store.data.cloudId = Number.isInteger(raw.cloudId) ? raw.cloudId : null;
      store.data.lastChangeAt = Number.isFinite(raw.lastChangeAt) ? raw.lastChangeAt : null;
      store.data.pools = isObject(raw.pools)
        ? Object.fromEntries(
            Object.entries(raw.pools)
              .filter(
                ([, pool]) =>
                  isObject(pool) && Number.isInteger(pool.id) && Array.isArray(pool.measurements),
              )
              .map(([id, pool]) => [
                id,
                { ...pool, measurements: pool.measurements.filter(isMeasurement) },
              ]),
          )
        : {};
      store.data.readAt = number(raw.readAt);
      store.data.windowAt = number(raw.windowAt);
      store.data.triedAt = number(raw.triedAt);
      store.data.specs = isObject(raw.specs) ? { ...raw.specs } : {};
      store.data.seen = isObject(raw.seen) ? { ...raw.seen } : {};
      store.data.accessRefused = isObject(raw.accessRefused) ? raw.accessRefused : null;
      store.data.lastError = isObject(raw.lastError) ? raw.lastError : null;
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, createStore };
