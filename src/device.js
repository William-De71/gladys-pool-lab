// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// One device per LabCom account (a sampling point: a pool, a spa), built on
// the id of the account in LabCom (never its name), named after its reference
// in LabCom ("pooltext"), else its owner, else its address. Read only.
//
// Features:
//   - `p<parameter id>`   one per parameter ever measured on this pool (the
//                         LabCom id of the parameter: one per method), the
//                         value of its last measurement; category, type,
//                         unit and bounds from parameters.js, frozen the first
//                         time it is offered;
//   - `water_balance`     text / text: which parameters are out of their
//                         ideal range ("pH too high · Free chlorine too
//                         low"), "All in range", or "No ideal range set".
// A parameter measured later adds a feature: Discovery then offers to update
// the device. A value out of the measuring range of the photometer
// (OVERRANGE / UNDERRANGE) has no number: the feature keeps its last value,
// the water balance, the widgets and the scenes say it.
//
// External ids: `ext:pool-lab:pool:<account id>`, features `…:<key>`.
// `should_poll` stays false: the integration reads LabCom on its own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { latestOf, poolName } from './pools.js';
import { byKind } from './parameters.js';

const POOL_TYPE = 'pool';
const BALANCE_KEY = 'water_balance';

/**
 * @description The external ids of a pool.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {number} id - The id of the account in LabCom.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const poolIds = (gladys, id) => gladys.externalIds(POOL_TYPE, String(id));

/**
 * @description The key of the feature of a parameter.
 * @param {number} parameterId - The LabCom parameter id.
 * @returns {string} "p48".
 */
const featureKey = (parameterId) => `p${parameterId}`;

/**
 * @description The id of the pool of a device external id, or of one of its features.
 * @param {unknown} externalId - `ext:pool-lab:pool:12` (or `…:12:p48`).
 * @returns {number|null} The id.
 */
function poolOfExternalId(externalId) {
  const match = String(externalId ?? '').match(/:pool:(\d+)(?::[a-z0-9_]+)?$/);
  return match ? Number(match[1]) : null;
}

/**
 * @description The label of a kind of parameter.
 * @param {string} kind - A kind (parameters.js).
 * @param {string} language - The language.
 * @returns {string} "Free chlorine".
 */
const kindLabel = (kind, language) => t(`kind_${kind}`, language);

/**
 * @description The label of an ideal range status.
 * @param {string} status - ok, too_low, too_high, not_set.
 * @param {string} language - The language.
 * @returns {string} "Too high".
 */
const statusLabel = (status, language) => t(`status_${status ?? 'not_set'}`, language);

/**
 * @description The label of a status inside a sentence: only its first
 * letter lowered (German nouns keep their capital: "im Bereich").
 * @param {string} status - ok, too_low, too_high, not_set.
 * @param {string} language - The language.
 * @returns {string} "too high", "im Bereich".
 */
function statusInText(status, language) {
  const label = statusLabel(status, language);
  return `${label.charAt(0).toLocaleLowerCase(language)}${label.slice(1)}`;
}

/**
 * @description The parameters of a pool, in the kind order: each with its
 * spec and its last measurement.
 * @param {object} pool - A pool (pools.js).
 * @param {object} specs - parameter id -> spec (frozen by app.js).
 * @returns {Array<{ parameterId: number, kind: string, spec: object, latest: object }>} Them.
 */
function parametersOf(pool, specs = {}) {
  return [...latestOf(pool).entries()]
    .filter(([parameterId]) => specs[parameterId])
    .map(([parameterId, latest]) => ({
      parameterId,
      kind: specs[parameterId].kind,
      spec: specs[parameterId],
      latest,
    }))
    .sort(byKind);
}

/**
 * @description The label of a parameter: its kind, or the LabCom name for
 * an unknown kind, with the LabCom name when two share a kind on the pool.
 * @param {object} parameter - A parametersOf() entry.
 * @param {object[]} all - Every parametersOf() entry of the pool.
 * @param {string} language - The language.
 * @returns {string} "Free chlorine", "Free chlorine (PL Chlorine Free)".
 */
function parameterLabel(parameter, all, language) {
  const name = parameter.spec.name || parameter.latest?.parameter || `#${parameter.parameterId}`;
  if (parameter.kind === 'other') return name.slice(0, 60);
  const label = kindLabel(parameter.kind, language);
  const twins = all.filter((other) => other.kind === parameter.kind).length > 1;
  return (twins ? `${label} (${name})` : label).slice(0, 80);
}

/**
 * @description The water balance of a pool, in a line.
 * @param {object[]} parameters - parametersOf().
 * @param {string} language - The language.
 * @returns {string} "pH too high · Free chlorine too low", "All in range"…
 */
function balanceText(parameters, language) {
  const out = parameters.filter(
    (p) => p.latest.status === 'too_low' || p.latest.status === 'too_high',
  );
  if (out.length) {
    return out
      .map((p) =>
        t('balanceOut', language, {
          parameter: parameterLabel(p, parameters, language),
          status: statusInText(p.latest.status, language),
        }),
      )
      .join(' · ')
      .slice(0, 250);
  }
  if (parameters.some((p) => p.latest.status === 'ok')) return t('balanceOk', language);
  return t('balanceNotSet', language);
}

/**
 * @description Build the device of a pool.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} pool - A pool (pools.js).
 * @param {object} specs - parameter id -> spec.
 * @param {object} [options] - `{ language }`.
 * @returns {object} The discovered device.
 */
function buildPoolDevice(gladys, pool, specs, { language = 'en' } = {}) {
  const ids = poolIds(gladys, pool.id);
  const parameters = parametersOf(pool, specs);
  const params = [{ name: 'LABCOM_ACCOUNT_ID', value: String(pool.id) }];
  if (Number.isFinite(pool.volume)) {
    params.push({
      name: 'POOL_VOLUME',
      value: `${pool.volume}${pool.volumeUnit ? ` ${pool.volumeUnit}` : ''}`.slice(0, 40),
    });
  }
  const serials = [...new Set(parameters.map((p) => p.latest.serial).filter(Boolean))];
  if (serials.length) {
    params.push({ name: 'DEVICE_SERIAL', value: serials.join(', ').slice(0, 100) });
  }
  return {
    name: poolName(pool),
    external_id: ids.device,
    model: 'PoolLab / PrimeLab (LabCom)',
    should_poll: false,
    params,
    features: [
      ...parameters.map((p) => ({
        name: parameterLabel(p, parameters, language),
        external_id: ids.feature(featureKey(p.parameterId)),
        category: p.spec.category,
        type: p.spec.type,
        unit: p.spec.unit,
        min: p.spec.min,
        max: p.spec.max,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      })),
      {
        name: t('featureBalance', language),
        external_id: ids.feature(BALANCE_KEY),
        category: C.TEXT,
        type: T.TEXT.TEXT,
        unit: null,
        min: 0,
        max: 0,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}

/**
 * @description Round a value to the decimals of its spec, within its bounds.
 * @param {object} spec - The spec.
 * @param {number} value - The value.
 * @returns {number} The value.
 */
function bounded(spec, value) {
  const factor = 10 ** spec.decimals;
  const rounded = Math.round(value * factor) / factor;
  return Math.min(spec.max, Math.max(spec.min, rounded));
}

/**
 * @description The states of a pool: a parameter without a number keeps its value.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} pool - A pool.
 * @param {object} specs - parameter id -> spec.
 * @param {object} [options] - `{ language }`.
 * @returns {object[]} `{ device_feature_external_id, state | text }`.
 */
function buildPoolStates(gladys, pool, specs, { language = 'en' } = {}) {
  const ids = poolIds(gladys, pool.id);
  const parameters = parametersOf(pool, specs);
  const states = parameters
    .filter((p) => Number.isFinite(p.latest.value) && !p.latest.range)
    .map((p) => ({
      device_feature_external_id: ids.feature(featureKey(p.parameterId)),
      state: bounded(p.spec, p.latest.value),
    }));
  if (parameters.length) {
    states.push({
      device_feature_external_id: ids.feature(BALANCE_KEY),
      text: balanceText(parameters, language),
    });
  }
  return states;
}

export {
  POOL_TYPE,
  BALANCE_KEY,
  poolIds,
  featureKey,
  poolOfExternalId,
  kindLabel,
  statusLabel,
  statusInText,
  parametersOf,
  parameterLabel,
  balanceText,
  buildPoolDevice,
  buildPoolStates,
  bounded,
};
