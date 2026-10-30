import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readValue,
  readInstant,
  readRange,
  readStatus,
  statusOf,
  parseMeasurement,
  parseCloud,
  latestByParameter,
  displayUnit,
} from '../src/parse.js';
import { fixtureCloud } from './helpers/fake-labcom.js';

test('values: strings or numbers, a decimal comma, out of the measuring range', () => {
  assert.deepEqual(readValue('7.2'), { value: 7.2, range: null });
  assert.deepEqual(readValue('7,2'), { value: 7.2, range: null });
  assert.deepEqual(readValue(0.45), { value: 0.45, range: null });
  assert.deepEqual(readValue('0'), { value: 0, range: null });
  assert.deepEqual(readValue('OVERRANGE'), { value: null, range: 'over' });
  assert.deepEqual(readValue('UNDERRANGE'), { value: null, range: 'under' });
  assert.deepEqual(readValue('>8'), { value: 8, range: 'over' });
  assert.deepEqual(readValue('< 0.1'), { value: 0.1, range: 'under' });
  assert.deepEqual(readValue(''), { value: null, range: null });
  assert.deepEqual(readValue(null), { value: null, range: null });
  assert.deepEqual(readValue('n/a'), { value: null, range: null });
});

test('timestamps: Unix seconds (schema), milliseconds, ISO; never 0', () => {
  assert.equal(readInstant(1761818400), 1761818400000);
  assert.equal(readInstant('1761818400'), 1761818400000);
  assert.equal(readInstant(1761818400000), 1761818400000);
  assert.equal(readInstant('2026-10-30T10:00:00Z'), Date.parse('2026-10-30T10:00:00Z'));
  assert.equal(readInstant(0), null);
  assert.equal(readInstant(null), null);
});

test('ideal range: the "NOT SET" rules of the LabCom help', () => {
  assert.deepEqual(readRange('7.0', '7.4'), { low: 7, high: 7.4 });
  assert.deepEqual(readRange('3', '1'), { low: 1, high: 3 });
  assert.equal(readRange(null, '7.4'), null);
  assert.equal(readRange('7', '7'), null);
  assert.equal(readRange('0', '999999999'), null);
  assert.equal(readRange('-999999999', '1'), null);
});

test('status: any spelling of the API, else worked out from the value', () => {
  assert.equal(readStatus('OKAY'), 'ok');
  assert.equal(readStatus('too_low'), 'too_low');
  assert.equal(readStatus('Too High'), 'too_high');
  assert.equal(readStatus('NOT SET'), 'not_set');
  assert.equal(readStatus(''), null);
  assert.equal(readStatus('maybe'), null);
  const range = { low: 7, high: 7.4 };
  assert.equal(statusOf(7.2, null, range), 'ok');
  assert.equal(statusOf(7, null, range), 'ok', 'a bound is in range');
  assert.equal(statusOf(6.9, null, range), 'too_low');
  assert.equal(statusOf(7.5, null, range), 'too_high');
  assert.equal(statusOf(null, 'over', range), 'too_high');
  assert.equal(statusOf(null, 'under', range), 'too_low');
  assert.equal(statusOf(7.5, null, null), 'not_set');
});

test('a measurement: ids and time required; the status computed when absent', () => {
  const raw = {
    id: '12',
    parameter_id: 48,
    parameter: 'PL pH',
    unit: 'pH',
    value: '7.62',
    ideal_low: '7.0',
    ideal_high: '7.4',
    ideal_status: null,
    timestamp: 1761818400,
  };
  const m = parseMeasurement(raw);
  assert.equal(m.id, 12);
  assert.equal(m.parameterId, 48);
  assert.equal(m.value, 7.62);
  assert.equal(m.status, 'too_high');
  assert.equal(m.at, 1761818400000);
  assert.equal(parseMeasurement({ ...raw, parameter_id: null }), null);
  assert.equal(parseMeasurement({ ...raw, id: 'x' }), null);
  assert.equal(parseMeasurement({ ...raw, timestamp: null }), null);
  assert.equal(parseMeasurement({ ...raw, ideal_status: 'OKAY' }).status, 'ok', 'the API wins');
  // The old names of the schema.
  assert.equal(
    parseMeasurement({ ...raw, parameter_id: undefined, parameterId: 49 }).parameterId,
    49,
  );
});

test('the made-up account: three accounts, measurements made safe, the last one per parameter', () => {
  const cloud = parseCloud(fixtureCloud());
  assert.equal(cloud.id, 5512);
  assert.deepEqual(
    cloud.accounts.map((a) => [a.id, a.pooltext, a.volume]),
    [
      [3101, 'Piscine', 48],
      [3102, 'Spa', 1.2],
      [3103, 'Pool house', null],
    ],
  );
  const latest = latestByParameter(cloud.accounts[0].measurements);
  assert.deepEqual(
    [...latest.keys()].sort((a, b) => a - b),
    [13, 20, 21, 30, 32, 48],
  );
  assert.equal(latest.get(48).value, 7.62);
  assert.equal(latest.get(32).status, 'ok', 'no status from the API: computed');
  const spa = latestByParameter(cloud.accounts[1].measurements);
  assert.deepEqual(
    [spa.get(13).value, spa.get(13).range, spa.get(13).status],
    [null, 'over', 'too_high'],
  );
  assert.deepEqual(parseCloud(null), { id: null, lastChangeAt: null, accounts: [] });
});

test('display units', () => {
  assert.equal(displayUnit('mg/l'), 'mg/l');
  assert.equal(displayUnit('mg/l (ppm)'), 'mg/l');
  assert.equal(displayUnit('pH'), '');
  assert.equal(displayUnit('°C'), '°C');
  assert.equal(displayUnit(''), '');
});
