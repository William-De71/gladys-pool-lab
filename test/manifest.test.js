import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  REFRESH_OUTPUTS,
  PARAMETER_OUTPUTS,
  OUT_STATUSES,
} from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS, PERIODS, DEFAULT_PERIOD } from '../src/widgets.js';
import {
  AUTO_LANGUAGE,
  POLL_INTERVALS,
  DEFAULT_POLL_MINUTES,
  OVERDUE_DELAYS,
  DEFAULT_OVERDUE_DAYS,
  normalizeConfig,
} from '../src/config.js';
import { KINDS } from '../src/parameters.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-pool-lab';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Pool Lab');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-pool-lab:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-pool-lab');
  const lock = read('../package-lock.json');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

test('declares the cloud transport: backend.labcom.cloud only, one query, never a mutation', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  const api = source('../src/labcom-api.js');
  assert.match(api, /https:\/\/backend\.labcom\.cloud\/graphql/);
  assert.doesNotMatch(api, /^\s*mutation/m);
  assert.match(api, /authorization: token,/, 'the raw token, as the two existing clients send it');
  for (const file of [
    'app',
    'parse',
    'pools',
    'parameters',
    'events',
    'widgets',
    'device',
    'store',
    'time',
    'config',
  ]) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('Gladys 5.3.0 for the catalog keywords, nothing more; no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.categories, ['environment', 'appliances']);
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /"source":"houses"/);
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'messaging',
    'energy_contracts',
    'music',
  ]) {
    assert.equal(manifest[key], undefined, key);
  }
  assert.doesNotMatch(source('../src/widgets.js'), /fields:/, 'no button form');
  const config = byKey(manifest.config_schema);
  assert.deepEqual(
    [config.get('api_token').type, config.get('api_token').required],
    ['secret', true],
  );
  for (const [key, options, fallback] of [
    ['poll_interval', POLL_INTERVALS, DEFAULT_POLL_MINUTES],
    ['overdue_after', OVERDUE_DELAYS, DEFAULT_OVERDUE_DAYS],
  ]) {
    assert.equal(config.get(key).type, 'select', key);
    assert.deepEqual(values(config.get(key)), options, key);
    assert.equal(config.get(key).default, String(fallback), key);
  }
  for (const field of manifest.config_schema) {
    assert.ok(['section', 'string', 'secret', 'select', 'boolean'].includes(field.type), field.key);
  }
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
  }
  assert.match(app, /onWidgetAction\(WIDGETS\.POOL/);
  assert.equal(byKey(manifest.widgets).get('pool').action_timeout_seconds, 60);
  assert.equal(byKey(manifest.widgets).get('parameter_history').action_timeout_seconds, undefined);
  assert.doesNotMatch(app, /onSetValue/, 'read only: no command');
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  const outputs = (key) =>
    byKey(manifest.scene_actions)
      .get(key)
      .outputs.map((output) => output.key);
  assert.deepEqual(outputs('refresh'), REFRESH_OUTPUTS);
  assert.deepEqual(outputs('get_parameter'), PARAMETER_OUTPUTS);
  // Every trigger field is a key of the event data (the core compares them),
  // and a variable too.
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((variable) => variable.key === field.key),
        `${trigger.key}.${field.key}`,
      );
      if (field.source) assert.equal(field.source, 'devices');
    }
  }
  const triggers = byKey(manifest.scene_triggers);
  for (const key of ['new_measurement', 'parameter_out_of_range', 'parameter_back_in_range']) {
    assert.deepEqual(values(byKey(triggers.get(key).fields).get('parameter')), KINDS, key);
  }
  assert.deepEqual(
    values(byKey(triggers.get('parameter_out_of_range').fields).get('status')),
    OUT_STATUSES,
  );
  const history = byKey(byKey(manifest.widgets).get('parameter_history').settings);
  assert.deepEqual(values(history.get('parameter')), KINDS);
  assert.deepEqual(values(history.get('period')), PERIODS);
  assert.equal(history.get('period').default, DEFAULT_PERIOD);
  const get = byKey(byKey(manifest.scene_actions).get('get_parameter').fields);
  assert.deepEqual(values(get.get('parameter')), KINDS);
  assert.equal(get.get('parameter').default, 'ph', 'a required field has a default');
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.fields.length <= 10, action.key);
    assert.ok(action.outputs.length <= 20, action.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    assert.ok((widget.settings ?? []).length <= 10);
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('offers the languages of the code, automatic by default', () => {
  const field = byKey(manifest.config_schema).get('language');
  assert.deepEqual(values(field), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(field.default, AUTO_LANGUAGE);
});

test('the configuration read from Gladys: the token without spaces, defaults', () => {
  assert.deepEqual(normalizeConfig({}), {
    token: '',
    pollMinutes: DEFAULT_POLL_MINUTES,
    overdueDays: DEFAULT_OVERDUE_DAYS,
    language: AUTO_LANGUAGE,
  });
  assert.deepEqual(
    normalizeConfig({
      api_token: ' abc\ndef ',
      poll_interval: '60',
      overdue_after: 0,
      language: 'de',
    }),
    { token: 'abcdef', pollMinutes: 60, overdueDays: 0, language: 'de' },
  );
  assert.equal(normalizeConfig({ poll_interval: '1' }).pollMinutes, DEFAULT_POLL_MINUTES);
  assert.equal(normalizeConfig(null).language, AUTO_LANGUAGE);
});

test('catalog keywords, no countries (a service used worldwide)', () => {
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  keywords.forEach((keyword) => assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword));
  assert.equal(new Set(keywords).size, keywords.length);
  assert.equal(manifest.countries, undefined);
});
