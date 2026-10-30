// -----------------------------------------------------------------------------
// Scene triggers and the keys of the scene actions.
//
// Triggers, once per transition, never at the first reading of a pool (the
// baseline: a restart replays nothing, the seen states live in /data), never
// because of a scene action (the detection runs on the timer only):
//   - `new_measurement`          a parameter has a newer measurement than the
//                                last one known (one event per parameter, for
//                                its newest measurement: a test of seven
//                                parameters gives seven events);
//   - `parameter_out_of_range`   the ideal range status of a parameter goes
//                                to too low or too high (from in range, not
//                                set, the other side, or a first measurement);
//   - `parameter_back_in_range`  it comes back to in range;
//   - `test_overdue`             no measurement on a pool for the delay of the
//                                configuration (7 days by default), between
//                                9:00 and 21:00 Gladys time; again after the
//                                next test;
//   - `access_refused`           LabCom refuses the API token.
// A measurement synchronized late but older than the last one known of its
// parameter changes nothing.
// -----------------------------------------------------------------------------

import { t } from './i18n.js';
import { kindLabel, statusLabel, statusInText, parameterLabel } from './device.js';
import { displayUnit } from './parse.js';

const TRIGGERS = {
  NEW_MEASUREMENT: 'new_measurement',
  OUT_OF_RANGE: 'parameter_out_of_range',
  BACK_IN_RANGE: 'parameter_back_in_range',
  TEST_OVERDUE: 'test_overdue',
  ACCESS_REFUSED: 'access_refused',
};

const SCENE_ACTIONS = {
  REFRESH: 'refresh',
  GET_PARAMETER: 'get_parameter',
};

const REFRESH_OUTPUTS = ['pool_count', 'out_of_range_count', 'last_measurement_at'];
const PARAMETER_OUTPUTS = [
  'pool_name',
  'parameter_name',
  'value',
  'value_text',
  'unit',
  'status',
  'status_label',
  'in_range',
  'ideal_low',
  'ideal_high',
  'measured_at',
  'days_since',
  'summary',
];
const OUT_STATUSES = ['too_low', 'too_high'];
const ACCESS_REASONS = ['missing', 'refused'];
// The reminder fires in the day only (Gladys time).
const OVERDUE_HOURS = [9, 21];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @description Keep only the declared keys of an output object.
 * @param {object} values - The values.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The outputs (null / undefined left out).
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== null && values[key] !== undefined)
      .map((key) => [key, values[key]]),
  );
}

/**
 * @description A number rounded, or null.
 * @param {number|null} value - The value.
 * @param {number} [decimals] - Decimals.
 * @returns {number|null} The value.
 */
function rounded(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description The value of a measurement as a text: "7.62", "> 8" (over the
 * measuring range), "over range".
 * @param {object} measurement - A measurement (parse.js).
 * @param {string} language - The language.
 * @param {number} [decimals] - Decimals of a number.
 * @returns {string} The text.
 */
function valueText(measurement, language, decimals = 2) {
  const number = Number.isFinite(measurement?.value)
    ? new Intl.NumberFormat(language, { maximumFractionDigits: decimals }).format(measurement.value)
    : null;
  if (measurement?.range === 'over') return number ? `> ${number}` : t('valueOver', language);
  if (measurement?.range === 'under') return number ? `< ${number}` : t('valueUnder', language);
  return number ?? '–';
}

const isOut = (status) => OUT_STATUSES.includes(status);

/**
 * @description The transitions of a pool since what the triggers knew.
 * @param {object} seen - What the triggers knew of the pool (never changed).
 * @param {object[]} parameters - parametersOf() of the pool.
 * @param {object} context - `{ now, overdueMs, hour }`: overdueMs 0 = off;
 * hour = the local hour of Gladys.
 * @returns {{ events: Array<{ key: string, parameter?: object, previous?: string }>, next: object }}
 * The events, the new knowledge.
 */
function detectPool(seen = {}, parameters, { now, overdueMs, hour }) {
  const first = !seen.known;
  const next = { known: true, params: { ...(seen.params ?? {}) }, overdue: seen.overdue === true };
  const events = [];
  const push = (event) => {
    if (!first) events.push(event);
  };
  for (const parameter of parameters) {
    const { latest } = parameter;
    const before = seen.params?.[parameter.parameterId];
    if (before && latest.at < before.at) {
      continue;
    }
    const isNew = !before || latest.id !== before.id;
    if (isNew) {
      push({ key: TRIGGERS.NEW_MEASUREMENT, parameter });
    }
    const previous = before?.status ?? null;
    if (previous !== latest.status) {
      if (isOut(latest.status)) {
        push({ key: TRIGGERS.OUT_OF_RANGE, parameter, previous });
      } else if (latest.status === 'ok' && isOut(previous)) {
        push({ key: TRIGGERS.BACK_IN_RANGE, parameter, previous });
      }
    }
    next.params[parameter.parameterId] = { id: latest.id, at: latest.at, status: latest.status };
  }
  const lastAt = Math.max(0, ...parameters.map((p) => p.latest.at));
  if (overdueMs > 0 && lastAt > 0) {
    const late = now - lastAt >= overdueMs;
    if (!late) {
      next.overdue = false;
    } else if (!next.overdue) {
      if (first) {
        next.overdue = true;
      } else if (hour >= OVERDUE_HOURS[0] && hour < OVERDUE_HOURS[1]) {
        push({ key: TRIGGERS.TEST_OVERDUE, lastAt });
        next.overdue = true;
      }
    }
  } else {
    next.overdue = false;
  }
  return { events, next };
}

/**
 * @description The data of a pool event, flat (30 keys at most, scalars).
 * @param {object} view - `{ deviceId, name, id }` of the pool.
 * @param {object[]} parameters - parametersOf() of the pool.
 * @param {object} event - A detectPool() event.
 * @param {object} context - `{ language, now }`.
 * @returns {object} The data.
 */
function eventData(view, parameters, event, { language, now }) {
  const data = {
    pool: view.deviceId,
    pool_name: String(view.name ?? '').slice(0, 1000),
    account_id: view.id,
  };
  if (event.key === TRIGGERS.TEST_OVERDUE) {
    return Object.assign(data, {
      last_measurement_at: new Date(event.lastAt).toISOString(),
      days_since: rounded((now - event.lastAt) / DAY_MS, 1),
    });
  }
  const { parameter } = event;
  const m = parameter.latest;
  Object.assign(data, {
    parameter: parameter.kind,
    parameter_label: parameterLabel(parameter, parameters, language).slice(0, 1000),
    parameter_name: (m.parameter || parameter.spec.name || '').slice(0, 1000),
    parameter_id: parameter.parameterId,
    value: m.range ? null : rounded(m.value, 3),
    value_text: valueText(m, language, 3),
    unit: displayUnit(m.unit),
    status: m.status,
    status_label: statusLabel(m.status, language),
    ideal_low: m.ideal ? m.ideal.low : null,
    ideal_high: m.ideal ? m.ideal.high : null,
    measured_at: new Date(m.at).toISOString(),
    device_serial: m.serial || null,
  });
  if (event.key !== TRIGGERS.NEW_MEASUREMENT) {
    Object.assign(data, {
      previous_status: event.previous ?? 'none',
      previous_status_label: event.previous
        ? statusLabel(event.previous, language)
        : t('statusNone', language),
    });
  }
  return data;
}

/**
 * @description The summary of a parameter for a scene text.
 * @param {object} parameter - A parametersOf() entry.
 * @param {object[]} parameters - parametersOf() of the pool.
 * @param {object} context - `{ language, formatWhen }`.
 * @returns {string} "pH 7.62 (too high, ideal 7.0–7.4), 18 Oct 18:40".
 */
function parameterSummary(parameter, parameters, { language, when }) {
  const m = parameter.latest;
  const unit = displayUnit(m.unit);
  const range = m.ideal
    ? t('summaryIdeal', language, {
        low: valueText({ value: m.ideal.low }, language, 3),
        high: valueText({ value: m.ideal.high }, language, 3),
      })
    : '';
  return t('summaryParameter', language, {
    parameter: parameterLabel(parameter, parameters, language),
    value: `${valueText(m, language, 3)}${unit ? ` ${unit}` : ''}`,
    status: [statusInText(m.status, language), range].filter(Boolean).join(', '),
    when,
  }).slice(0, 1000);
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  REFRESH_OUTPUTS,
  PARAMETER_OUTPUTS,
  OUT_STATUSES,
  ACCESS_REASONS,
  OVERDUE_HOURS,
  pick,
  rounded,
  valueText,
  detectPool,
  eventData,
  parameterSummary,
  kindLabel,
};
