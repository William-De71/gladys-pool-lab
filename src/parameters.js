// -----------------------------------------------------------------------------
// What a LabCom parameter measures, and how Gladys shows it.
//
// LabCom has one parameter id per method (pH by tablet, by liquid, by another
// photometer…: the LabCom web app lists 21 pH ids, 9 free chlorine ids). The
// kind of a parameter comes from the id lists of the LabCom web app
// (chemistrySetting.parameters, read in its bundle on 2026-10-30) for pH,
// free chlorine, cyanuric acid and temperature, else from its name
// ("PL Chlorine Total", "PL T-Alka"…). Feature keys never use the kind nor
// the name: they use the parameter id (device.js); the kind only chooses the
// category, the unit, the bounds, the label and the scene filter.
//
// Category pairs (constants of the SDK, icons of front/src/utils/consts.js):
//   - pH                ph-sensor / decimal, unit ph, 0-14;
//   - temperature       temperature-sensor / decimal, °C (°F when LabCom says
//                       so), -10-50 (14-122 °F);
//   - redox (ORP)       orp-sensor / decimal, mV, 0-1200;
//   - every other one   level-sensor / decimal: the core has no category for
//                       chlorine, bromine, alkalinity, hardness… This is the
//                       pair gladys-flipr uses for its chlorine (a plain
//                       numeric sensor, droplet icon); the unit is ppm when
//                       LabCom gives mg/l or ppm (the same in water), else
//                       none (°dH, °f, µS/cm, g/l: the name and the widgets
//                       carry the unit).
// The spec of a feature is frozen the first time it is offered (app.js keeps
// it in /data): a unit changed later in LabCom never changes the category,
// the unit or the bounds Discovery compares.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

// Order: the order of the tiles, the features and the scene options.
const KINDS = [
  'ph',
  'chlorine_free',
  'chlorine_total',
  'chlorine_combined',
  'bromine',
  'active_oxygen',
  'hydrogen_peroxide',
  'chlorine_dioxide',
  'ozone',
  'phmb',
  'cya',
  'alkalinity',
  'calcium_hardness',
  'total_hardness',
  'salt',
  'phosphate',
  'temperature',
  'orp',
  'other',
];

// Parameter ids of the LabCom web app (chemistrySetting.parameters).
const KNOWN_IDS = {
  ph: [
    48, 49, 181, 230, 231, 232, 233, 234, 235, 236, 237, 239, 280, 281, 282, 298, 301, 50, 74, 341,
    342,
  ],
  chlorine_free: [13, 115, 184, 297, 302, 321, 322, 351, 357],
  cya: [20, 185, 333],
  temperature: [124],
};

// Names, tried in this order (the more precise first).
const NAME_RULES = [
  ['chlorine_dioxide', /dioxid|clo2|clo₂/i],
  ['chlorine_combined', /combined|bound\s*chlor|chloramin|gebunden|combin/i],
  ['chlorine_total', /total\s*chlor|chlor\w*\s*total|gesamtchlor|dpd\s*3/i],
  ['cya', /cyanur|\bcya\b|stabili/i],
  ['phmb', /phmb|biguanid/i],
  ['hydrogen_peroxide', /peroxid|h2o2|h₂o₂/i],
  ['active_oxygen', /active\s*oxygen|aktivsauerstoff|oxyg[eè]ne\s*actif|\bo2\b|o₂|\bmps\b/i],
  ['ozone', /ozon|\bo3\b|o₃/i],
  ['bromine', /brom/i],
  ['chlorine_free', /chlor|dpd\s*1/i],
  ['alkalinity', /alka|\btac?\b|\bkh\b/i],
  ['calcium_hardness', /calcium|kalzium|calcique/i],
  ['total_hardness', /hardness|härte|duret[ée]|\bth\b|\bgh\b/i],
  ['salt', /salt|salz|\bsel\b|nacl|salin/i],
  ['phosphate', /phosphat/i],
  ['temperature', /temp/i],
  ['orp', /redox|\borp\b/i],
  ['ph', /\bph\b/i],
];

const LEVEL = (max, decimals = 2) => ({
  category: C.LEVEL_SENSOR,
  type: T.SENSOR.DECIMAL,
  concentration: true,
  min: 0,
  max,
  decimals,
});

// Gladys shape of each kind (unit decided by unitOf()).
const SHAPES = {
  ph: { category: C.PH_SENSOR, type: T.PH_SENSOR.DECIMAL, min: 0, max: 14, decimals: 2 },
  chlorine_free: LEVEL(20),
  chlorine_total: LEVEL(20),
  chlorine_combined: LEVEL(20),
  bromine: LEVEL(40),
  active_oxygen: LEVEL(100),
  hydrogen_peroxide: LEVEL(300),
  chlorine_dioxide: LEVEL(20),
  ozone: LEVEL(10),
  phmb: LEVEL(100, 1),
  cya: LEVEL(300, 0),
  alkalinity: LEVEL(500, 0),
  calcium_hardness: LEVEL(1000, 0),
  total_hardness: LEVEL(1000, 0),
  salt: LEVEL(10000, 1),
  phosphate: LEVEL(100),
  temperature: {
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    min: -10,
    max: 50,
    decimals: 1,
  },
  orp: { category: C.ORP_SENSOR, type: T.ORP_SENSOR.DECIMAL, min: 0, max: 1200, decimals: 0 },
  other: LEVEL(10000),
};

/**
 * @description The kind of a parameter.
 * @param {number} parameterId - Its LabCom id.
 * @param {string} [name] - Its LabCom name ("PL Chlorine Free").
 * @param {string} [unit] - Its LabCom unit ("mV" says redox).
 * @returns {string} One of KINDS.
 */
function kindOf(parameterId, name = '', unit = '') {
  const known = Object.entries(KNOWN_IDS).find(([, ids]) => ids.includes(parameterId));
  if (known) return known[0];
  const text = String(name ?? '');
  const rule = NAME_RULES.find(([, pattern]) => pattern.test(text));
  if (rule) return rule[0];
  if (/^\s*mv\s*$/i.test(String(unit ?? ''))) return 'orp';
  if (/°\s*[cf]\b/i.test(String(unit ?? ''))) return 'temperature';
  return 'other';
}

/**
 * @description The Gladys unit of a kind, from the unit LabCom gives.
 * @param {string} kind - The kind.
 * @param {string} unit - The LabCom unit.
 * @returns {string|null} A DEVICE_FEATURE_UNITS value, or null.
 */
function unitOf(kind, unit) {
  const text = String(unit ?? '');
  if (kind === 'ph') return U.PH;
  if (kind === 'orp') return U.MILLI_VOLT;
  if (kind === 'temperature') return /°\s*f/i.test(text) ? U.FAHRENHEIT : U.CELSIUS;
  return /mg\s*\/\s*l|ppm/i.test(text) ? U.PPM : null;
}

/**
 * @description The spec of the feature of a parameter (frozen by app.js).
 * @param {object} measurement - A measurement of the parameter (parse.js).
 * @returns {object} `{ kind, name, category, type, unit, min, max, decimals }`.
 */
function specOf(measurement) {
  const kind = kindOf(measurement.parameterId, measurement.parameter, measurement.unit);
  const shape = SHAPES[kind];
  const unit = unitOf(kind, measurement.unit);
  const fahrenheit = unit === U.FAHRENHEIT;
  return {
    kind,
    name: measurement.parameter,
    category: shape.category,
    type: shape.type,
    unit,
    min: fahrenheit ? 14 : shape.min,
    max: fahrenheit ? 122 : shape.max,
    decimals: shape.decimals,
  };
}

/**
 * @description Whether a stored spec has every field a feature needs.
 * @param {unknown} spec - The stored spec.
 * @returns {boolean} True when usable.
 */
function isSpec(spec) {
  return (
    Boolean(spec) &&
    KINDS.includes(spec.kind) &&
    typeof spec.category === 'string' &&
    typeof spec.type === 'string' &&
    (spec.unit === null || typeof spec.unit === 'string') &&
    Number.isFinite(spec.min) &&
    Number.isFinite(spec.max) &&
    Number.isInteger(spec.decimals)
  );
}

/**
 * @description Sort parameters: by kind order, then by id.
 * @param {{ kind: string, parameterId: number }} a - A parameter.
 * @param {{ kind: string, parameterId: number }} b - A parameter.
 * @returns {number} The order.
 */
const byKind = (a, b) =>
  KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.parameterId - b.parameterId;

export { KINDS, KNOWN_IDS, SHAPES, kindOf, unitOf, specOf, isSpec, byKind };
