// The made-up pools of test/fixtures/cloud.json, as app.js keeps them: merged
// (pools.js) and with their frozen specs (parameters.js). Nothing starts on
// import.
import { parseCloud } from '../../src/parse.js';
import { mergePools } from '../../src/pools.js';
import { specOf } from '../../src/parameters.js';
import { fixtureCloud } from './fake-labcom.js';

const NOW = Date.parse('2026-10-30T10:00:00Z');

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};

/**
 * @description The pools and their specs.
 * @returns {{ pools: object, specs: object }} id -> pool, id -> parameter id -> spec.
 */
function fixturePools() {
  const pools = mergePools({}, parseCloud(fixtureCloud()).accounts, { mode: 'all', now: NOW });
  const specs = {};
  for (const pool of Object.values(pools)) {
    specs[pool.id] = {};
    for (const m of pool.measurements) {
      specs[pool.id][m.parameterId] ??= specOf(m);
    }
  }
  return { pools, specs };
}

export { NOW, fakeGladys, fixturePools };
