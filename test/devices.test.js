// The discovered devices as Gladys checks them (lessons of the forum topic
// 11005): every field the core needs on every feature, category / type / unit
// from the SDK constants, no poll_frequency, should_poll explicit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  buildPoolDevice,
  buildPoolStates,
  poolOfExternalId,
  parametersOf,
  balanceText,
} from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';
import { fakeGladys, fixturePools } from './helpers/pools.js';

const { pools, specs } = fixturePools();
const device = (id, language = 'en') =>
  buildPoolDevice(fakeGladys, pools[id], specs[id], { language });

test('one device per LabCom account, on its id; read only, never polled by Gladys', () => {
  const pool = device(3101);
  assert.equal(pool.external_id, 'ext:test-integration:pool:3101');
  assert.equal(pool.name, 'Piscine');
  assert.equal(pool.should_poll, false);
  assert.equal(pool.poll_frequency, undefined);
  assert.deepEqual(pool.params, [
    { name: 'LABCOM_ACCOUNT_ID', value: '3101' },
    { name: 'POOL_VOLUME', value: '48 m³' },
    { name: 'DEVICE_SERIAL', value: 'PL2-104233' },
  ]);
  assert.equal(poolOfExternalId(pool.external_id), 3101);
  assert.equal(poolOfExternalId('ext:test-integration:pool:3101:p48'), 3101);
  assert.equal(poolOfExternalId('nope'), null);
});

test('one feature per parameter id, in the kind order, then the water balance', () => {
  assert.deepEqual(
    device(3101).features.map((f) => f.external_id.split(':').pop()),
    ['p48', 'p13', 'p21', 'p20', 'p30', 'p32', 'water_balance'],
  );
  assert.deepEqual(
    device(3102, 'fr').features.map((f) => f.name),
    ['pH', 'Chlore libre', 'Brome', 'Équilibre de l’eau'],
  );
});

test('every feature: min, max, read_only, has_feedback; pairs and units of the SDK', () => {
  const categories = Object.values(DEVICE_FEATURE_CATEGORIES);
  const types = Object.values(DEVICE_FEATURE_TYPES).flatMap((group) => Object.values(group));
  const units = Object.values(DEVICE_FEATURE_UNITS);
  for (const language of LANGUAGES) {
    for (const id of [3101, 3102]) {
      for (const feature of device(id, language).features) {
        for (const key of ['min', 'max']) assert.equal(typeof feature[key], 'number', key);
        assert.equal(feature.read_only, true);
        assert.equal(feature.has_feedback, false);
        assert.ok(categories.includes(feature.category), feature.category);
        assert.ok(types.includes(feature.type), feature.type);
        assert.ok(feature.unit === null || units.includes(feature.unit), feature.unit);
        assert.ok(feature.name.length > 0 && feature.name.length <= 100);
      }
    }
  }
  const byKey = Object.fromEntries(
    device(3101).features.map((f) => [f.external_id.split(':').pop(), f]),
  );
  assert.deepEqual(
    [byKey.p48.category, byKey.p48.type, byKey.p48.unit],
    ['ph-sensor', 'decimal', 'ph'],
  );
  assert.deepEqual(
    [byKey.p13.category, byKey.p13.type, byKey.p13.unit],
    ['level-sensor', 'decimal', 'ppm'],
  );
  assert.deepEqual([byKey.water_balance.category, byKey.water_balance.type], ['text', 'text']);
  assert.equal(byKey.p13.keep_history, true);
  assert.equal(byKey.water_balance.keep_history, false);
});

test('states: the last value of each parameter, within its bounds; none beyond the measuring range', () => {
  const states = buildPoolStates(fakeGladys, pools[3101], specs[3101], { language: 'en' });
  const value = (key) =>
    states.find((s) => s.device_feature_external_id.endsWith(`:${key}`))?.state;
  assert.equal(value('p48'), 7.62);
  assert.equal(value('p13'), 0.45);
  assert.equal(value('p32'), 260);
  assert.equal(
    states.find((s) => s.device_feature_external_id.endsWith(':water_balance')).text,
    'pH too high · Free chlorine too low · Total chlorine too low',
  );
  const spa = buildPoolStates(fakeGladys, pools[3102], specs[3102], { language: 'fr' });
  assert.equal(
    spa.some((s) => s.device_feature_external_id.endsWith(':p13')),
    false,
    'OVERRANGE',
  );
  const feature = device(3101).features[0];
  for (const state of states.filter((s) => 'state' in s)) {
    const f = device(3101).features.find((x) => x.external_id === state.device_feature_external_id);
    assert.ok(state.state >= f.min && state.state <= f.max, f.external_id);
  }
  assert.ok(feature);
});

test('water balance: all in range, or no range set', () => {
  const parameters = parametersOf(pools[3101], specs[3101]).map((p) => ({
    ...p,
    latest: { ...p.latest, status: 'ok' },
  }));
  assert.equal(balanceText(parameters, 'de'), 'Alles im Bereich');
  const none = parameters.map((p) => ({ ...p, latest: { ...p.latest, status: 'not_set' } }));
  assert.equal(balanceText(none, 'es'), 'Sin rango ideal definido');
});

test('a pool without measurements has no device; twins of a kind are told apart', () => {
  assert.equal(parametersOf(pools[3103], specs[3103]).length, 0);
  const twin = structuredClone(pools[3101]);
  twin.measurements.push({
    ...twin.measurements.find((m) => m.parameterId === 48),
    id: 1,
    parameterId: 49,
    parameter: 'PL pH liquid',
  });
  const twinSpecs = { ...specs[3101], 49: { ...specs[3101][48], name: 'PL pH liquid' } };
  const names = buildPoolDevice(fakeGladys, twin, twinSpecs, { language: 'en' }).features.map(
    (f) => f.name,
  );
  assert.ok(names.includes('pH (PL pH)'));
  assert.ok(names.includes('pH (PL pH liquid)'));
});
