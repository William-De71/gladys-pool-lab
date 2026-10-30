// -----------------------------------------------------------------------------
// Configuration of the Pool Lab integration.
//
// Fields of the config_schema:
//   - `api_token`      the personal API token of the LabCom account (created
//                      on https://labcom.cloud/pages/user-setting): a
//                      `secret`, never sent back to the UI, never logged,
//                      never written to /data (only a fingerprint), only sent
//                      to backend.labcom.cloud;
//   - `poll_interval`  minutes between two readings (5 to 60, 15 by
//                      default): the measurements are manual, they reach
//                      LabCom when the app synchronizes;
//   - `overdue_after`  days without a test before the `test_overdue`
//                      trigger fires (0: never), 7 by default;
//   - `language`       language of the texts Gladys does not ask for in a
//                      language (feature names, water balance, scene texts):
//                      `auto` follows the language of the last widget, or the
//                      timezone.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';

const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
const POLL_INTERVALS = ['5', '10', '15', '30', '60'];
const DEFAULT_POLL_MINUTES = 15;
const OVERDUE_DELAYS = ['0', '3', '7', '14', '30'];
const DEFAULT_OVERDUE_DAYS = 7;

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description A value of a select, else its default.
 * @param {unknown} raw - The value.
 * @param {string[]} options - The values of the select.
 * @param {number} fallback - The default.
 * @returns {number} The number.
 */
const readOption = (raw, options, fallback) => {
  const text = readString(raw);
  return options.includes(text) ? Number(text) : fallback;
};

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ token, pollMinutes, overdueDays, language }`.
 * @example
 * normalizeConfig({ api_token: ' abc ' }); // token 'abc'
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  // A pasted token often carries spaces or a line break: never part of it.
  const token = readString(config.api_token).replace(/\s+/g, '').slice(0, 4096);
  return {
    token,
    pollMinutes: readOption(config.poll_interval, POLL_INTERVALS, DEFAULT_POLL_MINUTES),
    overdueDays: readOption(config.overdue_after, OVERDUE_DELAYS, DEFAULT_OVERDUE_DAYS),
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// The timezones of the countries that speak the languages of the integration:
// the automatic language before any widget was shown.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Costa_Rica',
    'America/Panama',
  ],
};

/**
 * @description The language of the texts guessed from a timezone, before
 * any widget was shown.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) {
    return 'es';
  }
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

export {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  POLL_INTERVALS,
  DEFAULT_POLL_MINUTES,
  OVERDUE_DELAYS,
  DEFAULT_OVERDUE_DAYS,
  normalizeConfig,
  guessLanguage,
  readLanguage,
};
