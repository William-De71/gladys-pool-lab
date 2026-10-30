// -----------------------------------------------------------------------------
// The pools as the integration keeps them, merged from the readings.
//
// Three kinds of reading (app.js decides which one is due):
//   - `all`     every measurement (the first reading of an account): the last
//               value of each parameter, however old;
//   - `window`  the measurements of the last 400 days (every 6 hours): they
//               replace what was kept for that period, so a measurement
//               deleted or edited in LabCom is followed;
//   - `recent`  the measurements since a week before the newest one known (at
//               each round): added or updated by id. A week back because the
//               time of a measurement is the time of the photometer, and the
//               app may synchronize it days later.
// An account that is no longer in the answer is forgotten (its device stays
// in Gladys until the user deletes it).
//
// Kept per parameter: the last 300 measurements of the last 400 days (the
// history widget draws 300 points at most), and always the last one.
// -----------------------------------------------------------------------------

import { newestFirst, latestByParameter } from './parse.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_MS = 400 * DAY_MS;
const RECENT_BACK_MS = 7 * DAY_MS;
const MAX_POINTS = 300;
const READ_MODES = ['all', 'window', 'recent'];

/**
 * @description Keep the measurements worth keeping.
 * @param {object[]} measurements - Measurements of one pool.
 * @param {number} now - Now (ms).
 * @returns {object[]} Newest first.
 */
function prune(measurements, now) {
  const byParameter = new Map();
  for (const measurement of [...measurements].sort(newestFirst)) {
    const list = byParameter.get(measurement.parameterId) ?? [];
    const recent = now - measurement.at <= HISTORY_MS;
    if (list.length === 0 || (recent && list.length < MAX_POINTS)) {
      list.push(measurement);
    }
    byParameter.set(measurement.parameterId, list);
  }
  return [...byParameter.values()].flat().sort(newestFirst);
}

/**
 * @description Merge a reading into the pools kept.
 * @param {object} previous - The pools kept: id -> pool.
 * @param {object[]} accounts - The accounts read (parse.js).
 * @param {object} options - `{ mode, from, now }`: the kind of reading and,
 * for `window` and `recent`, the oldest time it asked for (ms).
 * @returns {object} The pools: id -> `{ ...account, measurements }`.
 */
function mergePools(previous, accounts, { mode, from = 0, now }) {
  const pools = {};
  for (const account of accounts) {
    const kept = previous?.[account.id]?.measurements ?? [];
    let measurements;
    if (mode === 'all') {
      measurements = account.measurements;
    } else if (mode === 'window') {
      measurements = [...kept.filter((m) => m.at < from), ...account.measurements];
    } else {
      const fresh = new Map(account.measurements.map((m) => [m.id, m]));
      measurements = [...kept.filter((m) => !fresh.has(m.id)), ...fresh.values()];
    }
    const unique = [...new Map(measurements.map((m) => [m.id, m])).values()];
    pools[account.id] = { ...account, measurements: prune(unique, now) };
  }
  return pools;
}

/**
 * @description The newest measurement time of every pool (0: none).
 * @param {object} pools - id -> pool.
 * @returns {number} Ms.
 */
function newestAt(pools) {
  return Object.values(pools ?? {}).reduce(
    (newest, pool) => Math.max(newest, ...(pool.measurements ?? []).map((m) => m.at)),
    0,
  );
}

/**
 * @description The last measurement of each parameter of a pool.
 * @param {object} pool - A pool.
 * @returns {Map<number, object>} parameter id -> measurement.
 */
const latestOf = (pool) => latestByParameter(pool?.measurements ?? []);

/**
 * @description The history of one parameter of a pool, oldest first.
 * @param {object} pool - A pool.
 * @param {number} parameterId - The parameter.
 * @param {number} since - The oldest time (ms).
 * @returns {object[]} Measurements.
 */
function historyOf(pool, parameterId, since) {
  return (pool?.measurements ?? [])
    .filter((m) => m.parameterId === parameterId && m.at >= since)
    .sort((a, b) => a.at - b.at || a.id - b.id);
}

/**
 * @description The name of a pool: its reference in LabCom ("pooltext"),
 * else the name of its owner, else its address, else "Pool Lab <id>".
 * @param {object} pool - A pool.
 * @returns {string} The name.
 */
function poolName(pool) {
  const owner = [pool?.forename, pool?.surname].filter(Boolean).join(' ');
  const address = [pool?.street, pool?.city].filter(Boolean).join(', ');
  return (pool?.pooltext || owner || address || `Pool Lab ${pool?.id ?? ''}`.trim()).slice(0, 100);
}

export {
  DAY_MS,
  HISTORY_MS,
  RECENT_BACK_MS,
  MAX_POINTS,
  READ_MODES,
  prune,
  mergePools,
  newestAt,
  latestOf,
  historyOf,
  poolName,
};
