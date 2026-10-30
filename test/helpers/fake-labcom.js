// -----------------------------------------------------------------------------
// A fake LabCom GraphQL API for the tests: an in-memory `fetch` (no network),
// answering like the real endpoint:
//   - POST /graphql with `Authorization: <token>` (no "Bearer") and a JSON
//     { query, variables } body;
//   - a missing or unknown token: HTTP 403 with an HTML "Forbidden" page, as
//     seen live on 2026-10-30;
//   - `Measurements(from: $from)` keeps the measurements from that time
//     (Unix seconds).
// The account is test/fixtures/cloud.json, a made-up one on the shapes of the
// published schema. Nothing starts on import (node --test also runs
// test/helpers/).
// -----------------------------------------------------------------------------

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = 'https://labcom.test/graphql';
const TOKEN = 'not-a-real-labcom-api-token';
const FORBIDDEN =
  '<!DOCTYPE html><html lang="en"><head><title>Forbidden</title></head><body>403 | Forbidden</body></html>';

/**
 * @description The made-up cloud account (a fresh copy).
 * @returns {object} The `CloudAccount`.
 */
const fixtureCloud = () =>
  JSON.parse(readFileSync(new URL('../fixtures/cloud.json', import.meta.url), 'utf8')).data
    .CloudAccount;

/**
 * @description A temporary folder standing for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'gladys-pool-lab-'));

/**
 * @description A logger that keeps every line (to check what is never logged).
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')}`,
      );
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
}

/**
 * @description The fake LabCom.
 * @param {object} [options] - `{ cloud, token }`.
 * @returns {object} `{ fetch, url, calls, cloud, failNext, addMeasurement }`.
 */
function createFakeLabcom({ cloud = fixtureCloud(), token = TOKEN } = {}) {
  const calls = [];
  const failures = [];
  const fake = {
    url: URL_,
    calls,
    cloud,
    /**
     * @description Answer the next request with this Response instead.
     * @param {Function} make - `() => Response`.
     */
    failNext(make) {
      failures.push(make);
    },
    /**
     * @description Add a measurement to an account.
     * @param {number} accountId - The account.
     * @param {object} measurement - The raw measurement.
     */
    addMeasurement(accountId, measurement) {
      fake.cloud.Accounts.find((a) => a.id === accountId).Measurements.push(measurement);
    },
    async fetch(url, init = {}) {
      const headers = Object.fromEntries(
        Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const body = JSON.parse(init.body ?? '{}');
      calls.push({ url, method: init.method, headers, body });
      if (failures.length) return failures.shift()();
      if (url !== URL_ || init.method !== 'POST') {
        return new Response('Not Found', { status: 404 });
      }
      if (headers.authorization !== token) {
        return new Response(FORBIDDEN, { status: 403, headers: { 'content-type': 'text/html' } });
      }
      const from = body.variables?.from;
      if (body.query.includes('$from') !== Number.isInteger(from)) {
        return Response.json({ errors: [{ message: 'Variable "$from" mismatch' }] });
      }
      const filtered = structuredClone(fake.cloud);
      if (Number.isInteger(from)) {
        for (const account of filtered.Accounts) {
          account.Measurements = account.Measurements.filter((m) => m.timestamp >= from);
        }
      }
      return Response.json({ data: { CloudAccount: filtered } });
    },
  };
  return fake;
}

export { createFakeLabcom, fixtureCloud, dataDir, recordingLogger, TOKEN, URL_ as URL, FORBIDDEN };
