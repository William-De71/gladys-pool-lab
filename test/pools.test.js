import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergePools,
  prune,
  newestAt,
  historyOf,
  poolName,
  MAX_POINTS,
  DAY_MS,
} from '../src/pools.js';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const m = (id, parameterId, daysAgo, value = 1) => ({
  id,
  parameterId,
  at: NOW - daysAgo * DAY_MS,
  value,
  range: null,
  status: 'ok',
});
const account = (id, measurements) => ({ id, pooltext: `Pool ${id}`, measurements });

test('all: the answer as it is; an account gone is forgotten', () => {
  const previous = { 1: account(1, [m(1, 48, 3)]), 9: account(9, [m(2, 48, 1)]) };
  const pools = mergePools(previous, [account(1, [m(3, 48, 1)])], { mode: 'all', now: NOW });
  assert.deepEqual(Object.keys(pools), ['1']);
  assert.deepEqual(
    pools[1].measurements.map((x) => x.id),
    [3],
  );
});

test('window: replaces what was kept from its start, keeps what is older', () => {
  const previous = { 1: account(1, [m(1, 48, 500), m(2, 48, 10), m(3, 48, 5)]) };
  const from = NOW - 400 * DAY_MS;
  const pools = mergePools(previous, [account(1, [m(3, 48, 5, 7.3), m(4, 48, 1)])], {
    mode: 'window',
    from,
    now: NOW,
  });
  // 2 was deleted in LabCom; 1 is older than the window: kept as the only
  // other value (it is not the last of its parameter, and older than 400 days).
  assert.deepEqual(
    pools[1].measurements.map((x) => x.id),
    [4, 3],
  );
});

test('recent: added or updated by id, nothing removed', () => {
  const previous = { 1: account(1, [m(1, 48, 30), m(2, 13, 20)]) };
  const pools = mergePools(previous, [account(1, [m(2, 13, 20, 9), m(5, 13, 1)])], {
    mode: 'recent',
    from: NOW - 27 * DAY_MS,
    now: NOW,
  });
  assert.deepEqual(
    pools[1].measurements.map((x) => [x.id, x.value]),
    [
      [5, 1],
      [2, 9],
      [1, 1],
    ],
  );
});

test('kept: 300 points of 400 days per parameter, and always the last one', () => {
  const many = Array.from({ length: 400 }, (_, i) => m(i + 1, 48, i * 0.5));
  const kept = prune([...many, m(1000, 13, 900)], NOW);
  assert.equal(kept.filter((x) => x.parameterId === 48).length, MAX_POINTS);
  assert.deepEqual(
    kept.filter((x) => x.parameterId === 13).map((x) => x.id),
    [1000],
  );
});

test('newest time, history of a parameter, names', () => {
  const pools = { 1: account(1, [m(1, 48, 3), m(2, 48, 1), m(3, 13, 2)]) };
  assert.equal(newestAt(pools), NOW - DAY_MS);
  assert.equal(newestAt({}), 0);
  assert.deepEqual(
    historyOf(pools[1], 48, NOW - 5 * DAY_MS).map((x) => x.id),
    [1, 2],
  );
  assert.equal(poolName({ id: 3, pooltext: 'Piscine' }), 'Piscine');
  assert.equal(poolName({ id: 3, forename: 'Camille', surname: 'Martin' }), 'Camille Martin');
  assert.equal(poolName({ id: 3, street: '1 rue', city: 'Lyon' }), '1 rue, Lyon');
  assert.equal(poolName({ id: 3 }), 'Pool Lab 3');
});
