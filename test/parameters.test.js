import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { KINDS, KNOWN_IDS, SHAPES, kindOf, unitOf, specOf, isSpec } from '../src/parameters.js';
import { TEXTS } from '../src/i18n.js';

test('the ids of the LabCom web app come first', () => {
  assert.equal(kindOf(48, 'anything'), 'ph');
  assert.equal(kindOf(357, ''), 'chlorine_free');
  assert.equal(kindOf(333, ''), 'cya');
  assert.equal(kindOf(124, ''), 'temperature');
  for (const [kind, ids] of Object.entries(KNOWN_IDS)) {
    ids.forEach((id) => assert.equal(kindOf(id), kind, `${id}`));
  }
});

test('else the name of the parameter (PoolLab names, the precise ones first)', () => {
  const cases = {
    'PL pH': 'ph',
    'PL Chlorine Free': 'chlorine_free',
    'PL Chlorine Total': 'chlorine_total',
    'PL Chlorine Combined': 'chlorine_combined',
    'PL Chlorine Dioxide': 'chlorine_dioxide',
    'PL Bromine': 'bromine',
    'PL Cyanuric Acid': 'cya',
    'PL T-Alka': 'alkalinity',
    'PL Calcium Hardness': 'calcium_hardness',
    'PL Total Hardness': 'total_hardness',
    'PL O₂': 'active_oxygen',
    'PL Hydrogen Peroxide HR': 'hydrogen_peroxide',
    'PL Ozone': 'ozone',
    'PL PHMB': 'phmb',
    'PL Phosphate': 'phosphate',
    Salt: 'salt',
    'Water temperature': 'temperature',
    Redox: 'orp',
    'PL Urea': 'other',
    '': 'other',
  };
  for (const [name, kind] of Object.entries(cases)) {
    assert.equal(kindOf(9999, name), kind, name);
  }
  assert.equal(kindOf(9999, 'Sensor 1', 'mV'), 'orp');
  assert.equal(kindOf(9999, 'Sensor 2', '°F'), 'temperature');
});

test('units: ppm for mg/l and ppm only; °F when LabCom says so', () => {
  assert.equal(unitOf('chlorine_free', 'mg/l'), DEVICE_FEATURE_UNITS.PPM);
  assert.equal(unitOf('chlorine_free', 'ppm'), DEVICE_FEATURE_UNITS.PPM);
  assert.equal(unitOf('total_hardness', '°dH'), null);
  assert.equal(unitOf('ph', ''), DEVICE_FEATURE_UNITS.PH);
  assert.equal(unitOf('orp', 'mV'), DEVICE_FEATURE_UNITS.MILLI_VOLT);
  assert.equal(unitOf('temperature', '°C'), DEVICE_FEATURE_UNITS.CELSIUS);
  assert.equal(unitOf('temperature', '°F'), DEVICE_FEATURE_UNITS.FAHRENHEIT);
  const spec = specOf({ parameterId: 124, parameter: 'Temp', unit: '°F' });
  assert.deepEqual([spec.unit, spec.min, spec.max], ['fahrenheit', 14, 122]);
});

test('every kind: a shape of the SDK constants, a label and a tile in the texts', () => {
  const categories = Object.values(DEVICE_FEATURE_CATEGORIES);
  const types = Object.values(DEVICE_FEATURE_TYPES).flatMap((group) => Object.values(group));
  for (const kind of KINDS) {
    const shape = SHAPES[kind];
    assert.ok(categories.includes(shape.category), kind);
    assert.ok(types.includes(shape.type), kind);
    assert.ok(shape.min < shape.max, kind);
    assert.ok(TEXTS[`kind_${kind}`] && TEXTS[`tile_${kind}`], kind);
  }
  // The pairs: pH, temperature, ORP have their category; the rest is the
  // plain numeric sensor gladys-flipr uses for chlorine.
  assert.equal(SHAPES.ph.category, 'ph-sensor');
  assert.equal(SHAPES.temperature.category, 'temperature-sensor');
  assert.equal(SHAPES.orp.category, 'orp-sensor');
  for (const kind of KINDS.filter((k) => !['ph', 'temperature', 'orp'].includes(k))) {
    assert.deepEqual([SHAPES[kind].category, SHAPES[kind].type], ['level-sensor', 'decimal'], kind);
  }
});

test('a spec is complete, and a broken stored one is refused', () => {
  const spec = specOf({ parameterId: 13, parameter: 'PL Chlorine Free', unit: 'mg/l' });
  assert.ok(isSpec(spec));
  assert.equal(spec.name, 'PL Chlorine Free');
  assert.equal(isSpec({ ...spec, kind: 'nope' }), false);
  assert.equal(isSpec({ ...spec, max: 'x' }), false);
  assert.equal(isSpec(null), false);
});
