// Every widget content as the core checks it (validateWidgetContent of the
// SDK), in the four languages, within the budget of a card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildPoolWidget,
  buildHistoryWidget,
  messageContent,
  periodDays,
  statusColor,
} from '../src/widgets.js';
import { parametersOf } from '../src/device.js';
import { historyOf, poolName, DAY_MS } from '../src/pools.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, fixturePools } from './helpers/pools.js';

const { pools, specs } = fixturePools();
const TZ = 'Europe/Paris';

/**
 * @description The view of a pool, as app.js builds it.
 * @param {number} id - The pool.
 * @param {object} [extra] - Fields to override.
 * @returns {object} The view.
 */
function viewOf(id, extra = {}) {
  const parameters = parametersOf(pools[id], specs[id]);
  return {
    id,
    name: poolName(pools[id]),
    pool: pools[id],
    parameters,
    lastAt: Math.max(0, ...parameters.map((p) => p.latest.at)),
    overdue: false,
    ...extra,
  };
}

/**
 * @description Check a content: valid, within the budget.
 * @param {object} content - The content.
 * @param {string} label - For the messages.
 */
function check(content, label) {
  assert.deepEqual(validateWidgetContent(content), [], label);
  const count = (types) => content.components.filter((c) => types.includes(c.type)).length;
  assert.ok(content.components.length <= 8, label);
  assert.ok(count(['chart', 'card-list', 'image']) <= 1, label);
  assert.ok(count(['value', 'gauge']) <= 6, label);
  assert.ok(count(['text']) <= 2, label);
  assert.ok(count(['status']) <= 1, label);
  assert.ok(count(['button']) <= 4, label);
  assert.ok(content.ttl_seconds >= 10 && content.ttl_seconds <= 3600, label);
}

test('pool: five tiles colored by status, the last test, the balance, the others as rows', () => {
  for (const language of LANGUAGES) {
    for (const id of [3101, 3102, 3103]) {
      check(
        buildPoolWidget({ view: viewOf(id), language, now: NOW, timeZone: TZ }),
        `${id} ${language}`,
      );
    }
  }
  const content = buildPoolWidget({ view: viewOf(3101), language: 'en', now: NOW, timeZone: TZ });
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.value, tile.color]),
    [
      ['pH', '7.62', 'warning'],
      ['Free chlorine', '0.45', 'warning'],
      ['Total chlorine', '0.8', 'warning'],
      ['Stabilizer', '42', 'success'],
      ['Alkalinity (TA)', '96', 'success'],
    ],
  );
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Last test', 'Water balance', 'Calcium hardness'],
  );
  assert.equal(rows[1].value, '3 out of range');
  assert.equal(content.components.at(-1).action.key, 'refresh');
});

test('pool: beyond the measuring range is red, without a unit; overdue is orange', () => {
  const content = buildPoolWidget({
    view: viewOf(3102, { overdue: true }),
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  const chlorine = content.components.find((c) => c.label === 'Free chlorine');
  assert.deepEqual([chlorine.value, chlorine.unit, chlorine.color], ['> max', undefined, 'danger']);
  assert.equal(content.components.find((c) => c.type === 'status').items[0].color, 'warning');
  assert.equal(statusColor({ status: 'not_set' }), 'neutral');
});

test('history: the measurements at their time, the ideal range as two lines', () => {
  for (const language of LANGUAGES) {
    for (const days of [30, 90, 365]) {
      const view = viewOf(3101);
      const parameter = view.parameters.find((p) => p.parameterId === 13);
      const content = buildHistoryWidget({
        poolName: view.name,
        parameter,
        parameters: view.parameters,
        history: historyOf(view.pool, 13, NOW - days * DAY_MS),
        days,
        language,
        now: NOW,
        timeZone: TZ,
      });
      check(content, `${days} ${language}`);
      const chart = content.components.find((c) => c.type === 'chart');
      assert.equal(chart.series.length, 3);
      assert.ok(chart.series[0].points.length > 0 && chart.series[0].points.length <= 300);
      assert.deepEqual(
        chart.series[1].points.map((p) => p.v),
        [1, 1],
      );
      assert.deepEqual(
        chart.series[2].points.map((p) => p.v),
        [3, 3],
      );
    }
  }
});

test('history: no range set, nothing in the period, one point only', () => {
  const view = viewOf(3101);
  const parameter = view.parameters.find((p) => p.parameterId === 32);
  const noRange = { ...parameter, latest: { ...parameter.latest, ideal: null, status: 'not_set' } };
  const base = {
    poolName: view.name,
    parameters: view.parameters,
    days: 30,
    now: NOW,
    timeZone: TZ,
  };
  for (const language of LANGUAGES) {
    const single = buildHistoryWidget({
      ...base,
      parameter: noRange,
      history: [noRange.latest],
      language,
    });
    check(single, language);
    assert.equal(single.components.find((c) => c.type === 'chart').series.length, 1);
    const empty = buildHistoryWidget({ ...base, parameter, history: [], language });
    check(empty, language);
    assert.equal(
      empty.components.some((c) => c.type === 'chart'),
      false,
    );
  }
  const ranged = buildHistoryWidget({
    ...base,
    parameter,
    history: [parameter.latest],
    language: 'en',
  });
  const chart = ranged.components.find((c) => c.type === 'chart');
  assert.notEqual(chart.series[1].points[0].t, chart.series[1].points[1].t, 'a line, not a dot');
});

test('messages and settings', () => {
  check(messageContent('x'.repeat(400), { heading: 'h'.repeat(60) }), 'message');
  assert.equal(periodDays('365'), 365);
  assert.equal(periodDays(undefined), 90);
  assert.equal(periodDays('12'), 90);
});
