// -----------------------------------------------------------------------------
// The Pool Lab integration: every handler, registered on a Gladys client.
//
// Brings the water tests of a LabCom account (Water-i.d. PoolLab 1.0 / 2.0,
// PrimeLab photometers) into Gladys, through the official LabCom GraphQL API
// and the personal API token of the account, read only:
//   - devices (device.js): one per LabCom account (a pool, a spa), one feature
//     per parameter measured (pH, free chlorine, cyanuric acid…) and the water
//     balance;
//   - scene triggers (events.js): new measurement, parameter out of / back in
//     its ideal range, test overdue, access refused;
//   - scene actions: refresh now, last value of a parameter;
//   - dashboard widgets (widgets.js): last test of a pool, history of a
//     parameter;
//   - configuration buttons: test the connection, diagnostic.
//
// The measurements are manual: the user tests the water with the photometer,
// the app synchronizes them with LabCom, and the integration reads LabCom on
// its own timer (15 minutes by default): the measurements of the last week
// at each round, the last 400 days every 6 hours, everything the first time.
// The scene triggers are worked out from what was read, never from a scene
// action.
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake LabCom (test/helpers/fake-labcom.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createLabcomClient } from './labcom-api.js';
import { createStore } from './store.js';
import { parseCloud, displayUnit } from './parse.js';
import { specOf, isSpec } from './parameters.js';
import {
  mergePools,
  newestAt,
  historyOf,
  poolName,
  HISTORY_MS,
  RECENT_BACK_MS,
  DAY_MS,
} from './pools.js';
import {
  poolIds,
  poolOfExternalId,
  parametersOf,
  parameterLabel,
  statusLabel,
  buildPoolDevice,
  buildPoolStates,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  REFRESH_OUTPUTS,
  PARAMETER_OUTPUTS,
  pick,
  rounded,
  valueText,
  detectPool,
  eventData,
  parameterSummary,
  kindLabel,
} from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  messageContent,
  buildPoolWidget,
  buildHistoryWidget,
  periodDays,
} from './widgets.js';
import {
  MINUTE_MS,
  HOUR_MS,
  defaultTimeZone,
  usableTimeZone,
  localParts,
  formatWhen,
} from './time.js';
import { t, all, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
};
const TICK_MS = 30 * 1000;
// No burst at startup: the first reading waits a little, even when due.
const STARTUP_DELAY_MS = 10 * 1000;
const RETRY_MS = 2 * MINUTE_MS;
const WINDOW_EVERY_MS = 6 * HOUR_MS;
const ACCESS_RETRY_MS = 30 * MINUTE_MS;
// A manual refresh (button, scene action) at most once a minute.
const MANUAL_EVERY_MS = MINUTE_MS;
// Re-send unchanged values so that Gladys does not show them as outdated:
// a pool is tested once or twice a week.
const HEARTBEAT_MS = 6 * HOUR_MS;
const MAX_EVENTS_PER_ROUND = 100;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const USER_AGENT = `gladys-pool-lab/${VERSION} (+https://github.com/William-De71/gladys-pool-lab)`;

/**
 * @description A short fingerprint (16 hexadecimal characters).
 * @param {string} value - The value.
 * @returns {string|null} The fingerprint.
 */
const fingerprint = (value) =>
  value ? createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16) : null;

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport of LabCom (tests).
 * @param {string} [options.url] - The endpoint (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    url,
    dataDir,
    now = () => Date.now(),
    timeZone: zone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdDevices = new Set();
  let lastStatus = null;
  let lastDiscovery = null;
  let lastAccessTry = 0;
  let lastManual = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });
  const api = createLabcomClient({
    getToken: () => config.token,
    userAgent: USER_AGENT,
    now,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(url ? { url } : {}),
  });

  const hasToken = () => Boolean(config.token);
  const pollMs = () => config.pollMinutes * MINUTE_MS;
  const overdueMs = () => config.overdueDays * DAY_MS;

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- What is known of a pool -------------------------------------------------------

  /**
   * @description The pools, in the order of their LabCom ids.
   * @returns {object[]} Pools (pools.js).
   */
  const allPools = () => Object.values(store.data.pools).sort((a, b) => a.id - b.id);

  /**
   * @description The pools with at least one measured parameter.
   * @returns {object[]} Pools.
   */
  const measuredPools = () =>
    allPools().filter((pool) => parametersOf(pool, store.data.specs[pool.id]).length > 0);

  /**
   * @description The view of a pool the widgets, the scenes and the states use.
   * @param {object} pool - A pool.
   * @returns {object} The view.
   */
  function viewOf(pool) {
    const parameters = parametersOf(pool, store.data.specs[pool.id]);
    const lastAt = Math.max(0, ...parameters.map((p) => p.latest.at));
    return {
      id: pool.id,
      deviceId: poolIds(gladys, pool.id).device,
      name: poolName(pool),
      pool,
      parameters,
      lastAt,
      overdue: overdueMs() > 0 && lastAt > 0 && now() - lastAt >= overdueMs(),
    };
  }

  /**
   * @description How many parameters of a pool are out of their ideal range.
   * @param {object} view - viewOf().
   * @returns {number} The count.
   */
  const outCount = (view) =>
    view.parameters.filter((p) => ['too_low', 'too_high'].includes(p.latest.status)).length;

  /**
   * @description Freeze the spec of every parameter seen for the first time.
   */
  function freezeSpecs() {
    const specs = {};
    for (const pool of allPools()) {
      const kept = store.data.specs[pool.id] ?? {};
      const next = Object.fromEntries(Object.entries(kept).filter(([, spec]) => isSpec(spec)));
      for (const measurement of pool.measurements) {
        if (!next[measurement.parameterId]) {
          next[measurement.parameterId] = specOf(measurement);
        }
      }
      specs[pool.id] = next;
    }
    store.data.specs = specs;
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {object} err - The error (`kind`, `code`).
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    if (err?.kind === 'auth') {
      return t(err.code === 'missing' ? 'statusNoToken' : 'errToken', lang);
    }
    const key = {
      rate_limit: 'errRateLimit',
      server: 'errServer',
      unreachable: 'errUnreachable',
    }[err?.kind];
    if (key) {
      return t(key, lang);
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!hasToken()) {
      await reportStatus(false, all('statusNoToken'));
      return;
    }
    if (store.data.accessRefused) {
      await reportStatus(
        false,
        all((lang) => errorText(store.data.accessRefused, lang)),
      );
      return;
    }
    if (!store.data.readAt) {
      await reportStatus(true, all('statusWaiting'));
      return;
    }
    const pools = measuredPools().map(viewOf);
    if (pools.length === 0) {
      await reportStatus(true, all('statusNoPool', { count: allPools().length }));
      return;
    }
    const out = pools.reduce((sum, view) => sum + outCount(view), 0);
    await reportStatus(
      true,
      all((lang) =>
        [
          t('statusOk', lang, { count: pools.length, out }),
          ...(api.pausedUntil() ? [t('statusPaused', lang)] : []),
        ].join(' '),
      ),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(
        `Pool Lab: ${key}${data.account_id !== undefined ? ` (pool ${data.account_id})` : ''}`,
      );
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of the measured pools, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = measuredPools().map((pool) =>
      buildPoolDevice(gladys, pool, store.data.specs[pool.id], { language: lang }),
    );
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of every pool whose device exists.
   * @returns {Promise<void>}
   */
  async function publishAllStates() {
    for (const pool of measuredPools()) {
      if (!createdDevices.has(poolIds(gladys, pool.id).device)) {
        continue;
      }
      const states = buildPoolStates(gladys, pool, store.data.specs[pool.id], {
        language: textLanguage(),
      });
      if (!states.length) {
        continue;
      }
      await gladys
        .publishChangedStates(states, { heartbeat: HEARTBEAT_MS })
        .catch((err) =>
          logger.warn(`Unable to publish the states of pool ${pool.id}: ${err.message}`),
        );
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description Remember a refusal of the token (the trigger fires once, from the timer).
   * @param {object} err - The error.
   */
  function refused(err) {
    const code = err.code === 'missing' ? 'missing' : 'refused';
    const announced = store.data.accessRefused?.code === code && store.data.accessRefused.announced;
    store.data.accessRefused = { kind: 'auth', code, announced: Boolean(announced) };
    lastAccessTry = now();
  }

  /**
   * @description Note the error of a reading.
   * @param {Error} err - The error.
   */
  function noteError(err) {
    const kind = err.kind ?? 'failed';
    logger.warn(`LabCom reading (${kind}): ${err.message}`);
    store.data.lastError = { kind, message: String(err.message).slice(0, 200), at: now() };
  }

  /**
   * @description The kind of reading due, and from when.
   * @returns {{ mode: string, from: number|null }} `from` in ms, null for every measurement.
   */
  function readingPlan() {
    if (!store.data.readAt) {
      return { mode: 'all', from: null };
    }
    const newest = newestAt(store.data.pools);
    if (!newest || now() - store.data.windowAt >= WINDOW_EVERY_MS) {
      return { mode: 'window', from: now() - HISTORY_MS };
    }
    return { mode: 'recent', from: Math.max(newest - RECENT_BACK_MS, now() - HISTORY_MS) };
  }

  /**
   * @description Read LabCom when due.
   * @param {object} [options] - `{ force }`: read now.
   * @returns {Promise<{ changed: boolean, error: object|null }>} What happened.
   */
  async function runReadings({ force = false } = {}) {
    if (!hasToken()) {
      return { changed: false, error: { kind: 'auth', code: 'missing' } };
    }
    if (!force && store.data.accessRefused && now() - lastAccessTry < ACCESS_RETRY_MS) {
      return { changed: false, error: store.data.accessRefused };
    }
    if (api.pausedUntil()) {
      return { changed: false, error: { kind: 'rate_limit' } };
    }
    const due =
      force ||
      store.data.accessRefused ||
      (now() - store.data.readAt >= pollMs() &&
        now() - store.data.triedAt >= Math.min(pollMs(), RETRY_MS));
    if (!due) {
      return { changed: false, error: null };
    }
    store.data.triedAt = now();
    lastAccessTry = now();
    const { mode, from } = readingPlan();
    let error = null;
    try {
      const { cloud, errors } = await api.pools(
        from === null ? {} : { from: Math.floor(from / 1000) },
      );
      const parsed = parseCloud(cloud);
      if (store.data.cloudId !== null && parsed.id !== null && parsed.id !== store.data.cloudId) {
        // Another LabCom account: what was kept belongs to the previous one.
        logger.info('Another LabCom account: starting again');
        store.data.pools = {};
        store.data.specs = {};
        store.data.seen = {};
      }
      store.data.cloudId = parsed.id ?? store.data.cloudId;
      store.data.lastChangeAt = parsed.lastChangeAt;
      store.data.pools = mergePools(store.data.pools, parsed.accounts, {
        mode,
        from: from ?? 0,
        now: now(),
      });
      for (const id of Object.keys(store.data.seen)) {
        if (!store.data.pools[id]) delete store.data.seen[id];
      }
      freezeSpecs();
      store.data.readAt = now();
      if (mode !== 'recent') {
        store.data.windowAt = now();
      }
      if (store.data.accessRefused) {
        logger.info('LabCom accepts the API token again');
        store.data.accessRefused = null;
      }
      if (errors.length) {
        store.data.lastError = {
          kind: 'graphql',
          message: errors.join('; ').slice(0, 200),
          at: now(),
        };
      }
    } catch (err) {
      noteError(err);
      if (err.kind === 'auth') {
        refused(err);
      }
      error = err;
    }
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    refreshWidgets();
    return { changed: true, error };
  }

  /**
   * @description Work out the scene events from what was read (timer only).
   * @returns {Promise<void>}
   */
  async function detectEvents() {
    const events = [];
    const lang = textLanguage();
    const { hour } = localParts(now(), timeZone);
    const refusal = store.data.accessRefused;
    if (refusal && !refusal.announced) {
      events.push({
        key: TRIGGERS.ACCESS_REFUSED,
        data: { message: errorText(refusal, lang).slice(0, 1000) },
      });
      refusal.announced = true;
    }
    for (const pool of measuredPools()) {
      const view = viewOf(pool);
      const found = detectPool(store.data.seen[pool.id], view.parameters, {
        now: now(),
        overdueMs: overdueMs(),
        hour,
      });
      store.data.seen[pool.id] = found.next;
      for (const event of found.events) {
        events.push({
          key: event.key,
          data: eventData(view, view.parameters, event, { language: lang, now: now() }),
        });
      }
    }
    if (events.length) {
      await store.save();
      await publishEvents(events.slice(0, MAX_EVENTS_PER_ROUND));
      refreshWidgets();
    }
  }

  /**
   * @description One round of the timer: the reading due, then the triggers.
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = (async () => {
        await runReadings();
        await detectEvents();
        await refreshStatus();
      })()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description A refresh asked by the user (button, scene action): at most
   * once a minute, after the round running; no scene event from it.
   * @returns {Promise<{ read: boolean, error: object|null }>} What happened.
   */
  async function manualRefresh() {
    if (running) {
      await running;
    }
    if (now() - lastManual < MANUAL_EVERY_MS) {
      return { read: false, error: null };
    }
    lastManual = now();
    const result = await runReadings({ force: true });
    await refreshStatus();
    return { read: true, error: result.error };
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  /**
   * @description Start again when the token is not the one the data was read with.
   */
  function checkToken() {
    const current = fingerprint(config.token);
    if (store.data.token !== current) {
      store.data.token = current;
      store.data.accessRefused = null;
      store.data.readAt = 0;
      store.data.triedAt = 0;
      lastAccessTry = 0;
    }
  }

  /**
   * @description Offer the devices, publish what is known, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    checkToken();
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    await refreshStatus();
    schedule();
  }

  /**
   * @description The pool a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {object|null} The view of the pool, the first one by default.
   */
  function target(externalId) {
    const id = poolOfExternalId(externalId);
    const pools = measuredPools();
    const pool = pools.find((item) => item.id === id) ?? pools[0] ?? null;
    return pool ? viewOf(pool) : null;
  }

  /**
   * @description The newest parameter of a kind on a pool.
   * @param {object} view - viewOf().
   * @param {string} kind - A kind.
   * @returns {object|null} A parametersOf() entry.
   */
  const parameterOfKind = (view, kind) =>
    view.parameters.filter((p) => p.kind === kind).sort((a, b) => b.latest.at - a.latest.at)[0] ??
    null;

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The message a widget shows when there is no pool to show.
   * @param {string} lang - The language.
   * @returns {object|null} The content, null when there are pools.
   */
  function widgetMessage(lang) {
    if (!hasToken()) {
      return messageContent(t('statusNoToken', lang));
    }
    if (store.data.accessRefused) {
      return messageContent(errorText(store.data.accessRefused, lang));
    }
    if (measuredPools().length === 0) {
      return messageContent(
        store.data.readAt
          ? t('statusNoPool', lang, { count: allPools().length })
          : t('statusWaiting', lang),
      );
    }
    return null;
  }

  gladys.onWidgetGet(WIDGETS.POOL, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    return (
      widgetMessage(lang) ??
      buildPoolWidget({ view: target(settings.pool), language: lang, now: now(), timeZone })
    );
  });

  gladys.onWidgetGet(WIDGETS.HISTORY, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) {
      return message;
    }
    const view = target(settings.pool);
    const kind = String(settings.parameter ?? 'ph');
    const parameter = parameterOfKind(view, kind);
    if (!parameter) {
      return messageContent(
        t('widgetNoParameter', lang, { parameter: kindLabel(kind, lang), pool: view.name }),
        { heading: view.name },
      );
    }
    const days = periodDays(settings.period);
    return buildHistoryWidget({
      poolName: view.name,
      parameter,
      parameters: view.parameters,
      history: historyOf(view.pool, parameter.parameterId, now() - days * DAY_MS),
      days,
      language: lang,
      now: now(),
      timeZone,
    });
  });

  gladys.onWidgetAction(WIDGETS.POOL, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.REFRESH) {
      throw new Error(`Unknown action ${String(actionKey).slice(0, 40)}`);
    }
    const { read, error } = await manualRefresh();
    if (error) {
      return all((lang) => errorText(error, lang));
    }
    if (!read) {
      return all('toastTooSoon');
    }
    return all('toastRefreshed', { count: measuredPools().length });
  });

  // --- Scene actions -----------------------------------------------------------------

  // Reads now (once a minute at most); the triggers follow at the next round.
  gladys.onSceneAction(SCENE_ACTIONS.REFRESH, async () => {
    const lang = textLanguage();
    if (!hasToken()) {
      throw new Error(t('statusNoToken', lang));
    }
    const { error } = await manualRefresh();
    if (error) {
      throw new Error(errorText(error, lang).slice(0, 500));
    }
    const views = measuredPools().map(viewOf);
    const newest = Math.max(0, ...views.map((view) => view.lastAt));
    return pick(
      {
        pool_count: views.length,
        out_of_range_count: views.reduce((sum, view) => sum + outCount(view), 0),
        last_measurement_at: newest ? new Date(newest).toISOString() : null,
      },
      REFRESH_OUTPUTS,
    );
  });

  // Answers from what the timer read: no request.
  gladys.onSceneAction(SCENE_ACTIONS.GET_PARAMETER, async (fields = {}) => {
    const lang = textLanguage();
    if (!hasToken()) {
      throw new Error(t('statusNoToken', lang));
    }
    const view = target(fields.pool);
    if (!view) {
      throw new Error(t('errNoPool', lang));
    }
    const kind = String(fields.parameter ?? 'ph');
    const parameter = parameterOfKind(view, kind);
    if (!parameter) {
      throw new Error(
        t('widgetNoParameter', lang, { parameter: kindLabel(kind, lang), pool: view.name }),
      );
    }
    const m = parameter.latest;
    const when = formatWhen(m.at, { language: lang, timeZone, now: now() });
    return pick(
      {
        pool_name: view.name,
        parameter_name: parameterLabel(parameter, view.parameters, lang),
        value: m.range ? null : rounded(m.value, 3),
        value_text: valueText(m, lang, 3),
        unit: displayUnit(m.unit),
        status: m.status,
        status_label: statusLabel(m.status, lang),
        in_range: m.status === 'ok',
        ideal_low: m.ideal ? m.ideal.low : null,
        ideal_high: m.ideal ? m.ideal.high : null,
        measured_at: new Date(m.at).toISOString(),
        days_since: rounded((now() - m.at) / DAY_MS, 1),
        summary: parameterSummary(parameter, view.parameters, { language: lang, when }),
      },
      PARAMETER_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!hasToken()) {
      return all('statusNoToken');
    }
    store.data.accessRefused = null;
    lastManual = now();
    const { error } = await runReadings({ force: true });
    lastStatus = null;
    await refreshStatus();
    schedule();
    if (error) {
      return all((lang) => errorText(error, lang));
    }
    const pools = allPools();
    const names = pools.map(poolName).slice(0, 10).join(', ');
    const measured = measuredPools().length;
    return all((lang) =>
      t('testOk', lang, {
        count: pools.length,
        measured,
        names: names ? ` (${names})` : '',
      }).slice(0, 1000),
    );
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) && value ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone,
      token: config.token ? 'set' : 'missing',
      pollMinutes: config.pollMinutes,
      overdueDays: config.overdueDays,
      language: config.language,
      cloudId: store.data.cloudId,
      lastChangeAt: iso(store.data.lastChangeAt),
      readAt: iso(store.data.readAt),
      windowAt: iso(store.data.windowAt),
      accessRefused: store.data.accessRefused,
      lastError: store.data.lastError,
      api: { ...api.counts(), pausedUntil: iso(api.pausedUntil()) },
      pools: allPools().map((pool) => {
        const view = viewOf(pool);
        return {
          id: pool.id,
          created: createdDevices.has(view.deviceId),
          measurements: pool.measurements.length,
          lastAt: iso(view.lastAt),
          parameters: view.parameters.map((p) => ({
            id: p.parameterId,
            name: p.latest.parameter,
            scenario: p.latest.scenario,
            kind: p.kind,
            category: p.spec.category,
            unit: p.spec.unit,
            labcomUnit: p.latest.unit,
            value: p.latest.value,
            range: p.latest.range,
            formatted: p.latest.formatted,
            ideal: p.latest.ideal,
            status: p.latest.status,
            at: iso(p.latest.at),
          })),
          seen: store.data.seen[pool.id] ?? null,
        };
      }),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `Pool Lab diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
    if (!count) {
      store.data.readAt = 0;
      store.data.triedAt = 0;
      tick();
    }
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishAllStates();
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await store.save();
  });

  return {
    store,
    api,
    tick,
    runReadings,
    detectEvents,
    manualRefresh,
    viewOf,
    measuredPools,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, USER_AGENT, ACCESS_RETRY_MS, WINDOW_EVERY_MS, HEARTBEAT_MS };
