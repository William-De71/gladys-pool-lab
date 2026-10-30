// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The widgets of the made-up LabCom account of the tests
// (test/fixtures/cloud.json: a pool tested every four days, a spa), read by
// the real parser and merger (src/parse.js, src/pools.js) at a fixed "now",
// and drawn by the real widget builders (src/widgets.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildPoolWidget, buildHistoryWidget } = await load('src/widgets.js');
const { parseCloud } = await load('src/parse.js');
const { mergePools, historyOf, poolName, DAY_MS } = await load('src/pools.js');
const { specOf } = await load('src/parameters.js');
const { parametersOf } = await load('src/device.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));
const cloud = JSON.parse(readFileSync(`${repo}/test/fixtures/cloud.json`, 'utf8')).data
  .CloudAccount;

// Friday 30 October 2026, 11:00 in Paris; the last pool test was the evening before.
const NOW = Date.parse('2026-10-30T10:00:00Z');
const TZ = 'Europe/Paris';
const pools = mergePools({}, parseCloud(cloud).accounts, { mode: 'all', now: NOW });
const viewOf = (id) => {
  const specs = {};
  for (const m of pools[id].measurements) specs[m.parameterId] ??= specOf(m);
  const parameters = parametersOf(pools[id], specs);
  return {
    id,
    name: poolName(pools[id]),
    pool: pools[id],
    parameters,
    lastAt: Math.max(...parameters.map((p) => p.latest.at)),
    overdue: false,
  };
};
const pool = viewOf(3101);
const spa = viewOf(3102);
const chlorine = pool.parameters.find((p) => p.kind === 'chlorine_free');

const contents = {};
for (const language of LANGUAGES) {
  contents[language] = {
    pool: buildPoolWidget({ view: pool, language, now: NOW, timeZone: TZ }),
    parameter_history: buildHistoryWidget({
      poolName: pool.name,
      parameter: chlorine,
      parameters: pool.parameters,
      history: historyOf(pool.pool, chlorine.parameterId, NOW - 90 * DAY_MS),
      days: 90,
      language,
      now: NOW,
      timeZone: TZ,
    }),
    pool_spa: buildPoolWidget({ view: spa, language, now: NOW, timeZone: TZ }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
