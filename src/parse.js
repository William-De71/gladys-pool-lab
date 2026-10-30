// -----------------------------------------------------------------------------
// The answers of LabCom made safe (labcom-api.js): null is null, never 0.
//
// Tolerant on purpose (never tested with a real account): an id or a
// timestamp may come as a number or a string, a value as "7.2", "7,2", 7.2,
// "<0.1", ">8", "OVERRANGE" or "UNDERRANGE" (the photometer's measuring range
// exceeded: no number, ioBroker.labcom reads them so). A timestamp is in Unix
// seconds (schema); a value above 1e12 is read as milliseconds.
//
// The ideal range status, as the LabCom help describes it: "NOT SET" (no
// range: a bound missing, high equal to low, or beyond ±99999999), "TOO LOW"
// (low > value), "TOO HIGH" (high < value), "OKAY". The exact spelling of the
// API is unknown: the letters alone are compared ("TOO_LOW", "too low",
// "TooLow" are the same); an unknown or absent status is worked out from the
// value and the range with those rules. Out of the measuring range gives
// too high / too low when a range is set.
// -----------------------------------------------------------------------------

const STATUSES = ['ok', 'too_low', 'too_high', 'not_set'];
const NO_RANGE_LIMIT = 99999999;

/**
 * @description An integer id (a number or a digit string), else null.
 * @param {unknown} raw - The value.
 * @returns {number|null} The id.
 */
function readId(raw) {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw === 'string' && /^\s*\d{1,15}\s*$/.test(raw)) {
    return Number(raw.trim());
  }
  return null;
}

/**
 * @description A trimmed text, '' when absent.
 * @param {unknown} raw - The value.
 * @param {number} [max] - The longest kept.
 * @returns {string} The text.
 */
function readText(raw, max = 200) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/**
 * @description A number (a number, "7.2" or "7,2"), else null.
 * @param {unknown} raw - The value.
 * @returns {number|null} The number.
 */
function readNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim().replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text) ? Number(text) : null;
}

/**
 * @description The value of a measurement.
 * @param {unknown} raw - "7.2", 7.2, "<0.1", ">8", "OVERRANGE"…
 * @returns {{ value: number|null, range: string|null }} `range`: `over` or
 * `under` when the measuring range was exceeded.
 */
function readValue(raw) {
  const number = readNumber(raw);
  if (number !== null) {
    return { value: number, range: null };
  }
  const text = readText(raw).toUpperCase();
  if (/^OVER/.test(text) || /^>/.test(text)) {
    return { value: readNumber(text.replace(/^>\s*/, '')), range: 'over' };
  }
  if (/^UNDER/.test(text) || /^</.test(text)) {
    return { value: readNumber(text.replace(/^<\s*/, '')), range: 'under' };
  }
  return { value: null, range: null };
}

/**
 * @description An instant from Unix seconds (or ms, or an ISO text).
 * @param {unknown} raw - The timestamp.
 * @returns {number|null} Ms.
 */
function readInstant(raw) {
  const number = readNumber(raw);
  if (number !== null) {
    if (number <= 0) return null;
    return Math.round(number > 1e12 ? number : number * 1000);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * @description The ideal range of a measurement, null when not set.
 * @param {unknown} low - `ideal_low`.
 * @param {unknown} high - `ideal_high`.
 * @returns {{ low: number, high: number }|null} The range.
 */
function readRange(low, high) {
  const lo = readNumber(low);
  const hi = readNumber(high);
  if (lo === null || hi === null || lo === hi) return null;
  if (hi > NO_RANGE_LIMIT || lo < -NO_RANGE_LIMIT) return null;
  return lo < hi ? { low: lo, high: hi } : { low: hi, high: lo };
}

/**
 * @description The status the API gives, normalized.
 * @param {unknown} raw - `ideal_status`.
 * @returns {string|null} ok, too_low, too_high, not_set; null when unknown.
 */
function readStatus(raw) {
  const letters = readText(raw)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (['OK', 'OKAY', 'GOOD', 'IDEAL', 'INRANGE', 'NORMAL'].includes(letters)) return 'ok';
  if (['TOOLOW', 'LOW', 'BELOW', 'UNDER'].includes(letters)) return 'too_low';
  if (['TOOHIGH', 'HIGH', 'ABOVE', 'OVER'].includes(letters)) return 'too_high';
  if (['NOTSET', 'NONE', 'UNSET'].includes(letters)) return 'not_set';
  return null;
}

/**
 * @description The status of a value against a range (the LabCom rules).
 * @param {number|null} value - The value.
 * @param {string|null} range - `over`, `under` or null.
 * @param {object|null} ideal - `{ low, high }`.
 * @returns {string} ok, too_low, too_high, not_set.
 */
function statusOf(value, range, ideal) {
  if (!ideal) return 'not_set';
  if (range === 'over') return 'too_high';
  if (range === 'under') return 'too_low';
  if (value === null) return 'not_set';
  if (value < ideal.low) return 'too_low';
  if (value > ideal.high) return 'too_high';
  return 'ok';
}

/**
 * @description One measurement, or null when it cannot be used (no id, no
 * parameter id, no time).
 * @param {object} raw - A `Measurement` of the answer.
 * @returns {object|null} `{ id, parameterId, parameter, scenario, unit, value,
 * range, formatted, ideal, status, at, serial, comment }`.
 */
function parseMeasurement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = readId(raw.id);
  const parameterId = readId(raw.parameter_id ?? raw.parameterId);
  const at = readInstant(raw.timestamp);
  if (id === null || parameterId === null || at === null) return null;
  const { value, range } = readValue(raw.value);
  const ideal = readRange(raw.ideal_low ?? raw.idealLow, raw.ideal_high ?? raw.idealHigh);
  const given = readStatus(raw.ideal_status);
  const status = given ?? statusOf(value, range, ideal);
  return {
    id,
    parameterId,
    parameter: readText(raw.parameter, 100),
    scenario: readText(raw.scenario, 100),
    unit: readText(raw.unit, 30),
    value,
    range,
    formatted: readText(raw.formatted_value, 30),
    ideal,
    status,
    at,
    serial: readText(raw.device_serial, 60),
    comment: readText(raw.comment, 300),
  };
}

/**
 * @description One account (a sampling point: a pool, a spa).
 * @param {object} raw - An `Account` of the answer.
 * @returns {object|null} `{ id, pooltext, forename, surname, street, zipcode,
 * city, country, volume, volumeUnit, measurements }`.
 */
function parseAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = readId(raw.id);
  if (id === null) return null;
  const measurements = (Array.isArray(raw.Measurements) ? raw.Measurements : [])
    .map(parseMeasurement)
    .filter(Boolean);
  return {
    id,
    pooltext: readText(raw.pooltext, 100),
    forename: readText(raw.forename, 100),
    surname: readText(raw.surname, 100),
    street: readText(raw.street, 100),
    zipcode: readText(raw.zipcode, 20),
    city: readText(raw.city, 100),
    country: readText(raw.country, 60),
    volume: readNumber(raw.volume),
    volumeUnit: readText(raw.volume_unit, 20),
    measurements,
  };
}

/**
 * @description The cloud account.
 * @param {object} raw - The `CloudAccount` of the answer.
 * @returns {{ id: number|null, lastChangeAt: number|null, accounts: object[] }} It.
 */
function parseCloud(raw) {
  const accounts = (Array.isArray(raw?.Accounts) ? raw.Accounts : [])
    .map(parseAccount)
    .filter(Boolean);
  const unique = [...new Map(accounts.map((account) => [account.id, account])).values()];
  return {
    id: readId(raw?.id),
    lastChangeAt: readInstant(raw?.last_change_time),
    accounts: unique,
  };
}

/**
 * @description Which of two measurements is the newer one (time, then id).
 * @param {object} a - A measurement.
 * @param {object} b - A measurement.
 * @returns {number} Negative when a is newer.
 */
const newestFirst = (a, b) => b.at - a.at || b.id - a.id;

/**
 * @description The last measurement of each parameter.
 * @param {object[]} measurements - Measurements.
 * @returns {Map<number, object>} parameter id -> measurement.
 */
function latestByParameter(measurements) {
  const latest = new Map();
  for (const measurement of [...measurements].sort(newestFirst)) {
    if (!latest.has(measurement.parameterId)) {
      latest.set(measurement.parameterId, measurement);
    }
  }
  return latest;
}

/**
 * @description A short display unit: "mg/l (ppm)" -> "mg/l"; "pH" -> "".
 * @param {string} unit - The unit of LabCom.
 * @returns {string} The unit.
 */
function displayUnit(unit) {
  const text = String(unit ?? '').trim();
  if (!text || /^ph$/i.test(text)) return '';
  return text.split(/\s+\(/)[0].replace(/[()]/g, '').trim().slice(0, 12);
}

export {
  STATUSES,
  readId,
  readNumber,
  readValue,
  readInstant,
  readRange,
  readStatus,
  statusOf,
  parseMeasurement,
  parseAccount,
  parseCloud,
  newestFirst,
  latestByParameter,
  displayUnit,
};
