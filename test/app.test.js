// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// LabCom (test/helpers/fake-labcom.js), an in-memory fetch. No test touches
// the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, ACCESS_RETRY_MS, WINDOW_EVERY_MS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, REFRESH_OUTPUTS, PARAMETER_OUTPUTS } from '../src/events.js';
import { FILE } from '../src/store.js';
import {
  createFakeLabcom,
  dataDir,
  recordingLogger,
  TOKEN,
  FORBIDDEN,
} from './helpers/fake-labcom.js';

const NOW = Date.parse('2026-10-30T10:00:00Z'); // 11:00 in Paris
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CONFIG = { api_token: TOKEN, language: 'en' };
const PREFIX = 'ext:test-integration';
const id = (pool, feature) => `${PREFIX}:pool:${pool}${feature ? `:${feature}` : ''}`;

/**
 * @description The integration, connected to a fake Gladys and a fake LabCom.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, dir, clock, fake }`.
 * @returns {Promise<object>} `{ gladys, app, fake, clock, dir, logger }`.
 */
async function startApp(t, { config = CONFIG, dir = dataDir(), clock = { now: NOW }, fake } = {}) {
  fake ??= createFakeLabcom();
  const logger = recordingLogger();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: fake.fetch,
    url: fake.url,
    dataDir: dir,
    now: () => clock.now,
    timeZone: 'Europe/Paris',
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
  });
  return { gladys, app, fake, clock, dir, logger };
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const fromOf = (call) => call.body.variables?.from ?? null;
const measurement = (extra) => ({
  scenario: '428-Chlorine-Free',
  parameter: 'PL Chlorine Free',
  parameter_id: 13,
  unit: 'mg/l',
  comment: '',
  device_serial: 'PL2-104233',
  ideal_low: '1',
  ideal_high: '3',
  ideal_status: null,
  ...extra,
});

test('startup: every measurement once, the measured pools offered, no state, no event', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  assert.equal(fake.calls.length, 0, 'no request before the timer');
  await app.tick();
  assert.equal(fake.calls.length, 1);
  assert.equal(fromOf(fake.calls[0]), null, 'the first reading: everything');
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.name, device.external_id]),
    [
      ['Piscine', id(3101)],
      ['Spa', id(3102)],
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to LabCom: 2 pool(s), 5 parameter(s) out of range.',
      fr: 'Connecté à LabCom : 2 bassin(s), 5 paramètre(s) hors plage.',
      de: 'Mit LabCom verbunden: 2 Becken, 5 Parameter außerhalb des Bereichs.',
      es: 'Conectado a LabCom: 2 piscina(s), 5 parámetro(s) fuera de rango.',
    },
  });
  assert.deepEqual(gladys.fake.states, [], 'no state before the devices exist');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'never at the first reading');
});

test('the pace: nothing before the interval; a week back each round, 400 days every 6 hours', async (t) => {
  const { app, fake, clock } = await startApp(t);
  await app.tick();
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 1, 'not due yet');
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 2);
  const newest = Date.parse('2026-10-29T17:35:22Z');
  assert.equal(
    fromOf(fake.calls[1]),
    Math.floor((newest - 7 * DAY) / 1000),
    'a week before the newest',
  );
  clock.now = NOW + WINDOW_EVERY_MS;
  await app.tick();
  assert.equal(
    fromOf(fake.calls[2]),
    Math.floor((clock.now - 400 * DAY) / 1000),
    'the 400-day window',
  );
});

test('devices created: every state published, the water balance in the language', async (t) => {
  const { gladys, app } = await startApp(t, { config: { ...CONFIG, language: 'fr' } });
  await app.tick();
  await createAll(gladys);
  assert.equal(gladys.fake.lastState(id(3101, 'p48')), 7.62);
  assert.equal(gladys.fake.lastState(id(3101, 'p13')), 0.45);
  assert.equal(
    gladys.fake.lastState(id(3101, 'water_balance')),
    'pH trop haut · Chlore libre trop bas · Chlore total trop bas',
  );
  assert.equal(gladys.fake.lastState(id(3102, 'p13')), undefined, 'OVERRANGE: no number');
});

test('a new test synchronized: new measurement, back in range; once; never replayed after a restart', async (t) => {
  const dir = dataDir();
  const fake = createFakeLabcom();
  const clock = { now: NOW };
  const first = await startApp(t, { dir, fake, clock });
  await first.app.tick();
  await createAll(first.gladys);
  clock.now += 20 * MINUTE;
  fake.addMeasurement(
    3101,
    measurement({ id: 990001, value: '1.8', timestamp: Math.floor(clock.now / 1000) - 600 }),
  );
  await first.app.tick();
  const news = events(first.gladys, TRIGGERS.NEW_MEASUREMENT);
  assert.equal(news.length, 1);
  assert.equal(news[0].data.pool, id(3101));
  assert.equal(news[0].data.parameter, 'chlorine_free');
  assert.equal(news[0].data.value, 1.8);
  assert.equal(news[0].data.status, 'ok');
  const back = events(first.gladys, TRIGGERS.BACK_IN_RANGE);
  assert.equal(back.length, 1);
  assert.equal(back[0].data.previous_status, 'too_low');
  assert.equal(first.gladys.fake.lastState(id(3101, 'p13')), 1.8);
  clock.now += 20 * MINUTE;
  await first.app.tick();
  assert.equal(events(first.gladys, TRIGGERS.NEW_MEASUREMENT).length, 1, 'once');
  await first.gladys.fake.shutdown();

  const second = await startApp(t, { dir, fake, clock });
  clock.now += 20 * MINUTE;
  await second.app.tick();
  assert.deepEqual(second.gladys.fake.sceneEvents, [], 'the seen states are kept in /data');
});

test('a test out of range fires once; a scene action never fires a trigger', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  clock.now += 2 * MINUTE;
  fake.addMeasurement(
    3101,
    measurement({
      id: 990002,
      parameter_id: 48,
      parameter: 'PL pH',
      unit: 'pH',
      value: '6.6',
      ideal_low: '7.0',
      ideal_high: '7.4',
      ideal_status: 'TOO LOW',
      timestamp: Math.floor(clock.now / 1000),
    }),
  );
  const before = gladys.fake.sceneEvents.length;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  assert.equal(ack.success, true);
  assert.deepEqual(Object.keys(ack.data.outputs), REFRESH_OUTPUTS);
  assert.equal(gladys.fake.sceneEvents.length, before, 'no event from the action');
  await app.detectEvents();
  const out = events(gladys, TRIGGERS.OUT_OF_RANGE);
  assert.deepEqual(
    out.map((event) => [event.data.parameter, event.data.status, event.data.previous_status]),
    [['ph', 'too_low', 'too_high']],
  );
});

test('get_parameter: the declared outputs only, no request; errors in words', async (t) => {
  const { gladys, app, fake } = await startApp(t, { config: { ...CONFIG, language: 'de' } });
  await app.tick();
  const calls = fake.calls.length;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PARAMETER, {
    pool: id(3101),
    parameter: 'chlorine_free',
  });
  assert.equal(fake.calls.length, calls, 'no request');
  const { outputs } = ack.data;
  assert.ok(Object.keys(outputs).every((key) => PARAMETER_OUTPUTS.includes(key)));
  assert.deepEqual(
    [
      outputs.pool_name,
      outputs.parameter_name,
      outputs.value,
      outputs.unit,
      outputs.status,
      outputs.in_range,
    ],
    ['Piscine', 'Freies Chlor', 0.45, 'mg/l', 'too_low', false],
  );
  assert.equal(typeof outputs.summary, 'string');
  const spa = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PARAMETER, {
    pool: id(3102),
    parameter: 'chlorine_free',
  });
  assert.equal(spa.data.outputs.value, undefined, 'beyond the measuring range: no number');
  assert.equal(spa.data.outputs.value_text, 'Überlauf');
  const missing = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PARAMETER, {
    pool: id(3102),
    parameter: 'cya',
  });
  assert.equal(missing.success, false);
  assert.match(JSON.stringify(missing), /nie gemessen/);
});

test('a refused token: HTML 403, the status says it, the trigger fires once, retried after 30 min', async (t) => {
  const fake = createFakeLabcom({ token: 'the-real-one-elsewhere' });
  const { gladys, app, clock, logger } = await startApp(t, { fake });
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refuses the API token/);
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1);
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 1, 'no retry before 30 minutes');
  clock.now += ACCESS_RETRY_MS;
  await app.tick();
  assert.equal(fake.calls.length, 2);
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1, 'once per refusal');
  assert.ok(!logger.lines.some((line) => line.includes(TOKEN)), 'the token is never logged');
  const widget = await gladys.fake.widgetGet(WIDGETS.POOL, { settings: {}, language: 'fr' });
  assert.match(widget.data.content.components[0].text, /refuse le jeton/);
  // A new token: read again at once, accepted.
  fake.cloud.Accounts[0].pooltext = 'Piscine';
  await gladys.fake.configUpdated({ ...CONFIG, api_token: 'the-real-one-elsewhere' });
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('no token: nothing sent, the status and the widgets say what to do', async (t) => {
  const { gladys, app, fake } = await startApp(t, { config: { language: 'en' } });
  await app.tick();
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.es, /token de API/);
  const widget = await gladys.fake.widgetGet(WIDGETS.HISTORY, { settings: {}, language: 'en' });
  assert.deepEqual(validateWidgetContent(widget.data.content), []);
  const action = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  assert.equal(action.success, false);
});

test('widgets: valid in every language; the refresh button at most once a minute', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const settings of [{}, { pool: id(3102) }]) {
      const pool = await gladys.fake.widgetGet(WIDGETS.POOL, { settings, language });
      assert.deepEqual(validateWidgetContent(pool.data.content), [], language);
    }
    for (const settings of [
      {},
      { pool: id(3101), parameter: 'cya', period: '365' },
      { pool: id(3102), parameter: 'alkalinity' },
    ]) {
      const history = await gladys.fake.widgetGet(WIDGETS.HISTORY, { settings, language });
      assert.deepEqual(
        validateWidgetContent(history.data.content),
        [],
        `${language} ${JSON.stringify(settings)}`,
      );
    }
  }
  clock.now += 2 * MINUTE;
  const calls = fake.calls.length;
  const first = await gladys.fake.widgetAction(WIDGETS.POOL, WIDGET_ACTIONS.REFRESH, {});
  assert.match(JSON.stringify(first), /LabCom read: 2 pool/);
  assert.equal(fake.calls.length, calls + 1);
  const second = await gladys.fake.widgetAction(WIDGETS.POOL, WIDGET_ACTIONS.REFRESH, {});
  assert.match(JSON.stringify(second), /less than a minute/);
  assert.equal(fake.calls.length, calls + 1);
});

test('test the connection, the diagnostic (no token in it), /data in 0600', async (t) => {
  const { gladys, logger, dir } = await startApp(t);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.match(
    ack.data.en ?? JSON.stringify(ack),
    /3 pool\(s\) \(Piscine, Spa, Pool house\), 2 with measurements/,
  );
  const diagnostic = await gladys.fake.action(ACTIONS.DIAGNOSTIC, {});
  assert.equal(diagnostic.success, true);
  const lines = logger.lines.filter((line) => line.includes('Pool Lab diagnostic'));
  assert.ok(lines.length >= 1);
  assert.ok(!lines.some((line) => line.includes(TOKEN)));
  const path = join(dir, FILE);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const saved = readFileSync(path, 'utf8');
  assert.ok(!saved.includes(TOKEN), 'only a fingerprint of the token');
  assert.equal(JSON.parse(saved).cloudId, 5512);
});

test('another LabCom account behind a new token: what was kept is forgotten', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  fake.cloud.id = 7777;
  fake.cloud.Accounts = [fake.cloud.Accounts[1]];
  await gladys.fake.configUpdated({ ...CONFIG });
  await app.runReadings({ force: true });
  assert.deepEqual(Object.keys(app.store.data.pools), ['3102']);
  assert.deepEqual(Object.keys(app.store.data.specs), ['3102']);
});

test('server errors and 429 keep what was read; the status mentions a pause', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  clock.now += 20 * MINUTE;
  fake.failNext(() => new Response('<html>', { status: 503 }));
  await app.tick();
  assert.equal(app.store.data.lastError.kind, 'server');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(app.measuredPools().length, 2);
  clock.now += 20 * MINUTE;
  fake.failNext(() => new Response('', { status: 429, headers: { 'retry-after': '600' } }));
  await app.tick();
  assert.match(gladys.fake.connectionStatus.message.en, /asked to wait/);
  const calls = fake.calls.length;
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, calls, 'paused');
  fake.failNext(() => {
    throw new TypeError('fetch failed');
  });
  clock.now += 20 * MINUTE;
  await app.tick();
  assert.equal(app.store.data.lastError.kind, 'unreachable');
  assert.ok(FORBIDDEN);
});

test('a scan offers the devices again; onDeviceCreated republishes everything', async (t) => {
  const { gladys, app } = await startApp(t);
  await app.tick();
  const before = gladys.fake.discoveredDevices.length;
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, before);
  await createAll(gladys);
  assert.ok(gladys.fake.states.length > 0);
});
