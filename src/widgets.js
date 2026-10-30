// -----------------------------------------------------------------------------
// Dashboard widgets of the Pool Lab integration.
//
//   - `pool`               the last test of a pool: the main parameters as
//                          tiles colored by their ideal range status (in range
//                          green, out of range orange, beyond the measuring
//                          range of the photometer red, no range grey), when
//                          the last test was taken, the water balance, the
//                          other parameters as rows; a Refresh button;
//   - `parameter_history`  one parameter of a pool over 30, 90 or 365 days:
//                          the measurements at their real time (from LabCom,
//                          not the time Gladys received them) with the ideal
//                          range as two lines, the last value, how many tests
//                          and the share of them in range.
// Every text exists in the four languages (the content is cached per
// language). Content budget of a card: 8 components, 1 main one, 6 tiles,
// 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago } from './i18n.js';
import { formatWhen } from './time.js';
import { displayUnit } from './parse.js';
import { parameterLabel, statusInText } from './device.js';
import { valueText } from './events.js';

const WIDGETS = { POOL: 'pool', HISTORY: 'parameter_history' };
const WIDGET_ACTIONS = { REFRESH: 'refresh' };
const TTL_SECONDS = { pool: 600, history: 1800, message: 120 };
const MAX_TILES = 5;
const MAX_ROWS = 10;
const PERIODS = ['30', '90', '365'];
const DEFAULT_PERIOD = '90';
const MAX_POINTS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

const ICONS = {
  ph: 'droplet',
  chlorine_free: 'shield',
  chlorine_total: 'shield',
  chlorine_combined: 'shield',
  bromine: 'shield',
  active_oxygen: 'wind',
  hydrogen_peroxide: 'wind',
  chlorine_dioxide: 'shield',
  ozone: 'cloud',
  phmb: 'shield',
  cya: 'sun',
  alkalinity: 'sliders',
  calcium_hardness: 'layers',
  total_hardness: 'layers',
  salt: 'hexagon',
  phosphate: 'feather',
  temperature: 'thermometer',
  orp: 'zap',
  other: 'activity',
};

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description The color of a measurement.
 * @param {object} measurement - A measurement (parse.js).
 * @returns {string} A WIDGET_COLORS value.
 */
function statusColor(measurement) {
  if (measurement?.range) return WIDGET_COLORS.DANGER;
  if (measurement?.status === 'ok') return WIDGET_COLORS.SUCCESS;
  if (measurement?.status === 'too_low' || measurement?.status === 'too_high') {
    return WIDGET_COLORS.WARNING;
  }
  return WIDGET_COLORS.NEUTRAL;
}

/**
 * @description The short label of a parameter for a tile (24 characters).
 * @param {object} parameter - A parametersOf() entry.
 * @param {object[]} parameters - Every entry of the pool.
 * @param {string} language - The language.
 * @returns {string} "Free chlorine".
 */
function tileLabel(parameter, parameters, language) {
  const twins = parameters.filter((p) => p.kind === parameter.kind).length > 1;
  if (parameter.kind === 'other' || twins) {
    return clip(parameterLabel(parameter, parameters, language), 24);
  }
  return clip(t(`tile_${parameter.kind}`, language), 24);
}

/**
 * @description The value tile of a parameter.
 * @param {object} parameter - A parametersOf() entry.
 * @param {object[]} parameters - Every entry of the pool.
 * @param {string} language - The language.
 * @returns {object} The tile.
 */
function parameterTile(parameter, parameters, language) {
  const m = parameter.latest;
  const unit = displayUnit(m.unit);
  return {
    type: 'value',
    label: tileLabel(parameter, parameters, language),
    // Beyond the measuring range of the photometer: "> max" fits a tile.
    value: clip(
      m.range && !Number.isFinite(m.value)
        ? m.range === 'over'
          ? '> max'
          : '< min'
        : valueText(m, language, parameter.spec.decimals),
      12,
    ),
    ...(unit && !(m.range && !Number.isFinite(m.value)) ? { unit: clip(unit, 6) } : {}),
    icon: ICONS[parameter.kind] ?? ICONS.other,
    color: statusColor(m),
  };
}

/**
 * @description The "pool" widget.
 * @param {object} options - Options.
 * @param {object} options.view - `{ name, parameters, lastAt, overdue }` (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildPoolWidget({ view, language, now, timeZone }) {
  const { parameters } = view;
  const components = [{ type: 'text', variant: 'heading', text: clip(view.name, 40) }];
  if (!parameters.length) {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(t('widgetNoMeasurement', language), 300),
    });
    return { ttl_seconds: TTL_SECONDS.pool, components };
  }
  const tiles = parameters.slice(0, MAX_TILES);
  components.push(...tiles.map((p) => parameterTile(p, parameters, language)));
  const out = parameters.filter(
    (p) => p.latest.status === 'too_low' || p.latest.status === 'too_high',
  );
  const rows = [
    {
      label: clip(t('rowLastTest', language), 40),
      value: clip(
        t('rowWhen', language, {
          when: formatWhen(view.lastAt, { language, timeZone, now }),
          ago: ago(view.lastAt, now, language),
        }),
        40,
      ),
      color: view.overdue ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    {
      label: clip(t('rowBalance', language), 40),
      value: clip(
        out.length
          ? t('rowOutCount', language, { count: out.length })
          : parameters.some((p) => p.latest.status === 'ok')
            ? t('balanceOk', language)
            : t('balanceNotSet', language),
        40,
      ),
      color: out.length
        ? WIDGET_COLORS.WARNING
        : parameters.some((p) => p.latest.status === 'ok')
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.NEUTRAL,
    },
  ];
  for (const p of parameters.slice(MAX_TILES, MAX_TILES + MAX_ROWS - rows.length)) {
    const unit = displayUnit(p.latest.unit);
    rows.push({
      label: clip(parameterLabel(p, parameters, language), 40),
      value: clip(
        `${valueText(p.latest, language, p.spec.decimals)}${unit ? ` ${unit}` : ''} · ${statusInText(p.latest.status, language)}`,
        40,
      ),
      color: statusColor(p.latest),
    });
  }
  components.push({ type: 'status', items: rows });
  components.push({
    type: 'button',
    label: clip(t('buttonRefresh', language), 24),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS.pool, components };
}

/**
 * @description A number in the format of a language, for a caption.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @returns {string} "7,2".
 */
const number = (value, language) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 3 }).format(value);

/**
 * @description The "parameter history" widget.
 * @param {object} options - Options.
 * @param {string} options.poolName - The name of the pool.
 * @param {object} options.parameter - The parametersOf() entry shown.
 * @param {object[]} options.parameters - Every entry of the pool.
 * @param {object[]} options.history - Its measurements of the period, oldest first.
 * @param {number} options.days - The period, in days.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildHistoryWidget({
  poolName,
  parameter,
  parameters,
  history,
  days,
  language,
  now,
  timeZone,
}) {
  const label = parameterLabel(parameter, parameters, language);
  const heading = clip(`${label} · ${poolName}`, 40);
  const m = parameter.latest;
  const unit = displayUnit(m.unit);
  const points = history
    .filter((entry) => Number.isFinite(entry.value))
    .slice(-MAX_POINTS)
    .map((entry) => ({ t: new Date(entry.at).toISOString(), v: entry.value }));
  if (!points.length) {
    return messageContent(
      t('widgetNoHistory', language, {
        parameter: label,
        days,
        when: formatWhen(m.at, { language, timeZone, now }),
      }),
      { heading, ttl: TTL_SECONDS.history },
    );
  }
  const judged = history.filter((entry) => entry.status !== 'not_set');
  const inRange = judged.filter((entry) => entry.status === 'ok').length;
  const components = [
    { type: 'text', variant: 'heading', text: heading },
    parameterTile(parameter, parameters, language),
    {
      type: 'value',
      label: clip(t('tileTests', language, { days }), 24),
      value: history.length,
      icon: 'clipboard',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      label: clip(t('tileInRange', language), 24),
      value: judged.length ? Math.round((inRange / judged.length) * 100) : '–',
      ...(judged.length ? { unit: '%' } : {}),
      icon: 'check-circle',
      color: !judged.length
        ? WIDGET_COLORS.NEUTRAL
        : inRange === judged.length
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.WARNING,
    },
  ];
  const series = [{ name: clip(label, 24), points }];
  const ideal = m.ideal;
  if (ideal && points.length) {
    const ends = [
      points[0].t,
      points.at(-1).t === points[0].t ? new Date(now).toISOString() : points.at(-1).t,
    ];
    series.push(
      {
        name: clip(t('seriesIdealLow', language), 24),
        points: ends.map((time) => ({ t: time, v: ideal.low })),
      },
      {
        name: clip(t('seriesIdealHigh', language), 24),
        points: ends.map((time) => ({ t: time, v: ideal.high })),
      },
    );
  }
  components.push({
    type: 'chart',
    chart_type: 'line',
    ...(unit ? { unit: clip(unit, 6) } : {}),
    series,
  });
  components.push({
    type: 'text',
    variant: 'caption',
    text: clip(
      ideal
        ? t('captionIdeal', language, {
            low: number(ideal.low, language),
            high: number(ideal.high, language),
            unit,
          })
            .replace(/\s+$/, '')
            .replace(/\s+\./, '.')
        : t('captionNoIdeal', language),
      80,
    ),
  });
  return { ttl_seconds: TTL_SECONDS.history, components };
}

/**
 * @description The period of a widget setting, in days.
 * @param {unknown} raw - The setting.
 * @returns {number} 30, 90 or 365.
 */
const periodDays = (raw) => Number(PERIODS.includes(String(raw ?? '')) ? raw : DEFAULT_PERIOD);

export {
  WIDGETS,
  WIDGET_ACTIONS,
  TTL_SECONDS,
  MAX_TILES,
  PERIODS,
  DEFAULT_PERIOD,
  DAY_MS,
  ICONS,
  clip,
  messageContent,
  statusColor,
  buildPoolWidget,
  buildHistoryWidget,
  periodDays,
};
