// The scene triggers: one event per transition, never at the first reading,
// payloads flat and within the limits of the core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { detectPool, eventData, TRIGGERS, valueText, parameterSummary } from '../src/events.js';
import { parametersOf } from '../src/device.js';
import { NOW, fixturePools } from './helpers/pools.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const { pools, specs } = fixturePools();
const DAY = 24 * 60 * 60 * 1000;
const context = { now: NOW, overdueMs: 7 * DAY, hour: 11 };
const parameters = () => parametersOf(pools[3101], specs[3101]);
const view = { deviceId: 'ext:test-integration:pool:3101', name: 'Piscine', id: 3101 };

/**
 * @description The parameters with one of them changed.
 * @param {number} parameterId - The parameter.
 * @param {object} change - The fields of its last measurement to change.
 * @returns {object[]} parametersOf() entries.
 */
const changed = (parameterId, change) =>
  parameters().map((p) =>
    p.parameterId === parameterId ? { ...p, latest: { ...p.latest, ...change } } : p,
  );

test('the first reading is a baseline: no event, even out of range or overdue', () => {
  const { events, next } = detectPool(undefined, parameters(), { ...context, now: NOW + 30 * DAY });
  assert.deepEqual(events, []);
  assert.equal(next.known, true);
  assert.equal(next.overdue, true);
  assert.deepEqual(next.params[48], {
    id: parameters()[0].latest.id,
    at: parameters()[0].latest.at,
    status: 'too_high',
  });
});

test('a new measurement: one event per parameter; a transition fires its trigger', () => {
  const { next: seen } = detectPool(undefined, parameters(), context);
  assert.deepEqual(detectPool(seen, parameters(), context).events, [], 'nothing new');
  const latest = parameters().find((p) => p.parameterId === 13).latest;
  const back = detectPool(
    seen,
    changed(13, { id: 999, at: latest.at + DAY, value: 1.5, status: 'ok' }),
    context,
  );
  assert.deepEqual(
    back.events.map((e) => e.key),
    [TRIGGERS.NEW_MEASUREMENT, TRIGGERS.BACK_IN_RANGE],
  );
  assert.equal(back.events[1].previous, 'too_low');
  const same = detectPool(
    back.next,
    changed(13, { id: 1000, at: latest.at + 2 * DAY, value: 1.6, status: 'ok' }),
    context,
  );
  assert.deepEqual(
    same.events.map((e) => e.key),
    [TRIGGERS.NEW_MEASUREMENT],
    'still in range',
  );
  const out = detectPool(
    same.next,
    changed(13, { id: 1001, at: latest.at + 3 * DAY, value: 4, status: 'too_high' }),
    context,
  );
  assert.deepEqual(
    out.events.map((e) => e.key),
    [TRIGGERS.NEW_MEASUREMENT, TRIGGERS.OUT_OF_RANGE],
  );
  // From too high to too low: out of range again, the other side.
  const flip = detectPool(
    out.next,
    changed(13, { id: 1002, at: latest.at + 4 * DAY, value: 0.2, status: 'too_low' }),
    context,
  );
  assert.deepEqual(
    flip.events.map((e) => [e.key, e.previous]),
    [
      [TRIGGERS.NEW_MEASUREMENT, undefined],
      [TRIGGERS.OUT_OF_RANGE, 'too_high'],
    ],
  );
});

test('a late measurement older than the last one known changes nothing', () => {
  const { next: seen } = detectPool(undefined, parameters(), context);
  const latest = parameters()[0].latest;
  const late = detectPool(seen, changed(48, { id: 5, at: latest.at - DAY, status: 'ok' }), context);
  assert.deepEqual(late.events, []);
  assert.equal(late.next.params[48].id, latest.id);
});

test('a range edited in LabCom: the same measurement changes status, the transition fires', () => {
  const { next: seen } = detectPool(undefined, parameters(), context);
  const edited = detectPool(seen, changed(48, { status: 'ok' }), context);
  assert.deepEqual(
    edited.events.map((e) => e.key),
    [TRIGGERS.BACK_IN_RANGE],
  );
});

test('a parameter measured for the first time on a known pool', () => {
  const { next: seen } = detectPool(undefined, parameters().slice(1), context);
  const first = detectPool(seen, parameters(), context);
  assert.deepEqual(
    first.events.map((e) => [e.key, e.previous ?? null]),
    [
      [TRIGGERS.NEW_MEASUREMENT, null],
      [TRIGGERS.OUT_OF_RANGE, null],
    ],
  );
});

test('test overdue: once, in the day, again after the next test; off with 0', () => {
  const { next: seen } = detectPool(undefined, parameters(), context);
  const later = NOW + 8 * DAY;
  assert.deepEqual(
    detectPool(seen, parameters(), { ...context, now: later, hour: 3 }).events,
    [],
    'night',
  );
  const day = detectPool(seen, parameters(), { ...context, now: later, hour: 9 });
  assert.deepEqual(
    day.events.map((e) => e.key),
    [TRIGGERS.TEST_OVERDUE],
  );
  assert.deepEqual(detectPool(day.next, parameters(), { ...context, now: later + DAY }).events, []);
  const tested = changed(48, { id: 4242, at: later, status: 'ok' });
  const after = detectPool(day.next, tested, { ...context, now: later + DAY });
  assert.equal(after.next.overdue, false);
  assert.ok(!after.events.some((e) => e.key === TRIGGERS.TEST_OVERDUE));
  assert.deepEqual(
    detectPool(seen, parameters(), { ...context, now: later, overdueMs: 0 }).events,
    [],
  );
});

test('event data: flat, scalars, declared variables only, the fields of the trigger present', () => {
  const triggers = Object.fromEntries(manifest.scene_triggers.map((t) => [t.key, t]));
  const { next: seen } = detectPool(undefined, parameters(), context);
  const latest = parameters().find((p) => p.parameterId === 13).latest;
  const events = [
    ...detectPool(
      seen,
      changed(13, { id: 999, at: latest.at + DAY, value: 1.5, status: 'ok' }),
      context,
    ).events,
    ...detectPool(
      seen,
      changed(13, { id: 998, at: latest.at + DAY, value: 9, status: 'too_high' }),
      context,
    ).events,
    ...detectPool(seen, parameters(), { ...context, now: NOW + 9 * DAY }).events,
  ];
  assert.deepEqual(
    [...new Set(events.map((e) => e.key))].sort(),
    [
      TRIGGERS.BACK_IN_RANGE,
      TRIGGERS.NEW_MEASUREMENT,
      TRIGGERS.OUT_OF_RANGE,
      TRIGGERS.TEST_OVERDUE,
    ].sort(),
  );
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const event of events) {
      const data = eventData(view, parameters(), event, { language, now: NOW + 9 * DAY });
      const declared = triggers[event.key].variables.map((v) => v.key);
      assert.ok(Object.keys(data).length <= 30);
      for (const [key, value] of Object.entries(data)) {
        assert.ok(declared.includes(key), `${event.key}.${key} is not a variable`);
        assert.ok(
          value === null || ['string', 'number', 'boolean'].includes(typeof value),
          `${event.key}.${key}`,
        );
        if (typeof value === 'string') assert.ok(value.length <= 1000);
        if (typeof value === 'number') assert.ok(Number.isFinite(value));
      }
      for (const field of triggers[event.key].fields) {
        assert.ok(field.key in data, `${event.key}.${field.key}`);
      }
    }
  }
  const out = events.find((e) => e.key === TRIGGERS.OUT_OF_RANGE);
  const data = eventData(view, parameters(), out, { language: 'fr', now: NOW });
  assert.deepEqual(
    [
      data.parameter,
      data.parameter_id,
      data.value,
      data.unit,
      data.status,
      data.previous_status,
      data.ideal_low,
      data.ideal_high,
    ],
    ['chlorine_free', 13, 9, 'mg/l', 'too_high', 'too_low', 1, 3],
  );
  assert.equal(data.status_label, 'Trop haut');
});

test('values beyond the measuring range, and the summary of a parameter', () => {
  assert.equal(valueText({ value: null, range: 'over' }, 'en'), 'over range');
  assert.equal(valueText({ value: 8, range: 'over' }, 'fr'), '> 8');
  assert.equal(valueText({ value: 0.1, range: 'under' }, 'de'), '< 0,1');
  assert.equal(valueText({ value: null, range: null }, 'es'), '–');
  const ph = parameters()[0];
  assert.equal(
    parameterSummary(ph, parameters(), { language: 'en', when: '29 Oct, 18:35' }),
    'pH: 7.62 (too high, ideal 7–7.4), measured 29 Oct, 18:35',
  );
});
