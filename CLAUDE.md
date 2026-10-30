# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the **Water-i.d. PoolLab 1.0 /
2.0 and PrimeLab** water testers: a Node.js service (Node 22+, ESM, no build
step) in its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the official **LabCom** GraphQL API
(`POST https://backend.labcom.cloud/graphql`, console
`https://backend.labcom.cloud/graphiql`) with the personal API token of the
user (header `Authorization: <token>`, no "Bearer", as python_poollab and
ioBroker.labcom send it). **Read only**: one query, never a mutation.
`type: "device"`, Gladys 5.3.0+, `transports: ["cloud"]`. Not affiliated with
Water-i.d. **Never tested with a real account**: the query follows the
published schema (types: ids Int, `timestamp` Int in Unix seconds, `value` /
`ideal_low` / `ideal_high` / `ideal_status` String); checked live on
2026-10-30: no token → HTTP 403 with an HTML "Forbidden" page. The REST API
(`/api/v1/`) is not used.

## Commands

```bash
npm install
npm test                                  # node --test; a fake LabCom (in-memory fetch), never the network
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js               SDK wiring only (new GladysIntegration + createApp)
src/app.js             every handler; the timer (reading plan, triggers), devices and states,
                       scene events, scene actions, widgets, configuration buttons, status
src/labcom-api.js      GraphQL client: the query, the raw token, 401/403 (HTML) -> auth,
                       GraphQL errors, 429 pause, one request at a time
src/parse.js           the answers made safe (null is null, never 0): values ("7,2",
                       OVERRANGE, "<0.1"), Unix seconds, ideal range and status rules
src/parameters.js      kind of a parameter (LabCom id lists, then its name), category / unit / bounds
src/pools.js           the merge of the readings (all / window / recent), what is kept, names
src/device.js          one device per LabCom account, one feature per parameter id, water balance
src/events.js          triggers (transitions per parameter, reminder), keys, outputs, texts
src/widgets.js         last test of a pool, history of a parameter
src/time.js            local dates and times (Intl only)
src/store.js           /data/pool-lab.json (mode 0600)
src/config.js          API token, reading interval, reminder delay, language
src/i18n.js            helpers; src/i18n-texts.js the runtime texts, en / fr / de / es
test/helpers/fake-labcom.js     the fake LabCom (raw token, HTML 403, `from` filter)
test/helpers/pools.js           the made-up pools merged, with their specs
test/fixtures/cloud.json        a made-up account on the schema shapes (kept byte for byte)
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:pool:<LabCom account id>`, features `…:p<LabCom parameter
id>` and `…:water_balance`, feature `category` / `type` / `unit` / `min` /
  `max`, the keys of `config_schema` and `actions`, `last_language`, widgets
  and settings (and the kind values of `parameter`), triggers (fields, options,
  variables), scene actions (fields, outputs). Never a name or a label in a
  key. `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Frozen specs**: the category, unit and bounds of a parameter feature are
  computed once (`parameters.js` `specOf`) and kept in `/data` (`specs`); a
  change of the rules only applies to parameters seen for the first time.
- **Category pairs**: pH `ph-sensor` / `decimal` (ph), temperature
  `temperature-sensor` / `decimal` (°C, °F when LabCom says so), redox
  `orp-sensor` / `decimal` (mV), every other parameter `level-sensor` /
  `decimal` (ppm for mg/l or ppm, else no unit: the gladys-flipr choice for
  chlorine; the core has no chlorine, alkalinity or hardness category),
  water balance `text` / `text`.
- **Read only.** No mutation, no REST (`test/manifest.test.js` checks it).
- **The pace.** Every request goes through the client queue. First reading:
  every measurement; then each round (15 min by default) the measurements
  from a week before the newest known; the last 400 days every 6 hours. A 429
  pauses everything until its Retry-After (15 min without one). A manual
  refresh (widget button, scene action) at most once a minute. Never a request
  from `get_parameter` or a widget.
- **`should_poll` stays false**, no `poll_frequency`: own timer.
- **The token** is a `secret`, never logged, never in /data (a 16-hex
  fingerprint only, to start again when it changes), sent to
  backend.labcom.cloud only. Test tokens never look real
  (`not-a-real-labcom-api-token`).
- **Scene events** once per transition, never at the first reading (baseline),
  never from a scene action: the detection runs on the timer only
  (`detectEvents`). A late measurement older than the last known one of its
  parameter fires nothing. The reminder fires between 9:00 and 21:00 Gladys
  time.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n-texts.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted". A status inside a sentence only lowers
  its first letter (`statusInText`: German nouns keep their capital). Pool
  names come from LabCom, never translated.
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- The exact spelling of `ideal_status` is unknown (the LabCom help says NOT
  SET, TOO LOW, TOO HIGH, OKAY): only the letters are compared; absent or
  unknown, it is computed from the value and the range.
- `value` may be `OVERRANGE` / `UNDERRANGE` (out of the measuring range of the
  photometer): no number, the feature keeps its last value.
- One parameter id per method: the same pool can have two pH features; their
  names then carry the LabCom name.
- `Measurements(from: $from)` with a null variable is never sent: the query
  without the argument is used instead.
- A parameter shared by another LabCom user (`SharedAccounts`) is not read.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
