// The LabCom client against an in-memory fetch: headers, query, errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLabcomClient, API_URL, poolsQuery, retryAfterSeconds } from '../src/labcom-api.js';
import { createFakeLabcom, TOKEN, FORBIDDEN } from './helpers/fake-labcom.js';

const NOW = Date.parse('2026-10-30T10:00:00Z');

/**
 * @description A client on a scripted fetch.
 * @param {Function} answer - `(url, init) => Response`.
 * @param {object} [options] - `{ token, clock }`.
 * @returns {object} `{ client, calls }`.
 */
function scripted(answer, { token = TOKEN, clock = { now: NOW } } = {}) {
  const calls = [];
  const client = createLabcomClient({
    getToken: () => token,
    userAgent: 'gladys-pool-lab/test',
    now: () => clock.now,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    },
  });
  return { client, calls };
}

test('the official endpoint, the raw token (no Bearer), JSON, one query, never a mutation', async () => {
  assert.equal(API_URL, 'https://backend.labcom.cloud/graphql');
  const { client, calls } = scripted(() =>
    Response.json({ data: { CloudAccount: { id: 1, Accounts: [] } } }),
  );
  const { cloud } = await client.pools({ from: 1761800000 });
  assert.deepEqual(cloud, { id: 1, Accounts: [] });
  const [{ url, init }] = calls;
  assert.equal(url, API_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, TOKEN);
  assert.equal(init.headers['content-type'], 'application/json');
  assert.match(init.headers['user-agent'], /^gladys-pool-lab\//);
  assert.ok(init.signal, 'a timeout');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.variables, { from: 1761800000 });
  assert.match(body.query, /Measurements\(from: \$from\)/);
  assert.doesNotMatch(body.query, /mutation/i);
  for (const field of ['parameter_id', 'ideal_low', 'ideal_high', 'ideal_status', 'timestamp']) {
    assert.match(body.query, new RegExp(`\\b${field}\\b`));
  }
});

test('without a start date: every measurement, no variable', async () => {
  const { client, calls } = scripted(() => Response.json({ data: { CloudAccount: { id: 1 } } }));
  await client.pools();
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.variables, undefined);
  assert.equal(body.query, poolsQuery(false));
  assert.doesNotMatch(body.query, /\$from/);
});

test('no token: nothing is sent', async () => {
  const { client, calls } = scripted(() => Response.json({}), { token: '  ' });
  await assert.rejects(client.pools(), { kind: 'auth', code: 'missing' });
  assert.equal(calls.length, 0);
});

test('a refused token: 403 with an HTML page (as seen live), or 401', async () => {
  for (const status of [401, 403]) {
    const { client } = scripted(
      () => new Response(FORBIDDEN, { status, headers: { 'content-type': 'text/html' } }),
    );
    await assert.rejects(client.pools(), (err) => {
      assert.equal(err.kind, 'auth');
      assert.equal(err.code, 'refused');
      assert.doesNotMatch(err.message, new RegExp(TOKEN));
      return true;
    });
  }
  // The fake LabCom answers like the real one.
  const fake = createFakeLabcom({ token: 'another-token' });
  const client = createLabcomClient({
    getToken: () => TOKEN,
    userAgent: 'x',
    fetch: fake.fetch,
    url: fake.url,
  });
  await assert.rejects(client.pools(), { kind: 'auth' });
});

test('GraphQL errors: about the token -> auth, else graphql; partial data is used', async () => {
  const auth = scripted(() =>
    Response.json({ errors: [{ message: 'Unauthenticated.' }], data: { CloudAccount: null } }),
  );
  await assert.rejects(auth.client.pools(), { kind: 'auth' });
  const other = scripted(() => Response.json({ errors: [{ message: 'Syntax Error' }] }));
  await assert.rejects(other.client.pools(), { kind: 'graphql', message: /Syntax Error/ });
  const partial = scripted(() =>
    Response.json({ errors: [{ message: 'one field failed' }], data: { CloudAccount: { id: 2 } } }),
  );
  const { cloud, errors } = await partial.client.pools();
  assert.equal(cloud.id, 2);
  assert.deepEqual(errors, ['one field failed']);
  const none = scripted(() => Response.json({ data: { CloudAccount: null } }));
  await assert.rejects(none.client.pools(), { kind: 'graphql' });
});

test('server errors, a body that is not JSON, no answer', async () => {
  await assert.rejects(scripted(() => new Response('oops', { status: 502 })).client.pools(), {
    kind: 'server',
  });
  await assert.rejects(scripted(() => new Response('<html>', { status: 200 })).client.pools(), {
    kind: 'server',
  });
  await assert.rejects(scripted(() => Response.json({}, { status: 400 })).client.pools(), {
    kind: 'failed',
  });
  const { client } = scripted(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(client.pools(), { kind: 'unreachable' });
  assert.deepEqual(client.counts(), { requests: 1, failures: 1 });
});

test('429: every request waits for the Retry-After (15 minutes without one)', async () => {
  const clock = { now: NOW };
  let answers = 0;
  const { client, calls } = scripted(
    () => {
      answers += 1;
      return answers === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '120' } })
        : Response.json({ data: { CloudAccount: { id: 1 } } });
    },
    { clock },
  );
  await assert.rejects(client.pools(), { kind: 'rate_limit', retryAfter: 120 });
  assert.equal(client.pausedUntil(), NOW + 120000);
  await assert.rejects(client.pools(), { kind: 'rate_limit' });
  assert.equal(calls.length, 1, 'nothing sent during the pause');
  clock.now += 121000;
  assert.equal(client.pausedUntil(), 0);
  await client.pools();
  const bare = scripted(() => new Response('', { status: 429 }), { clock: { now: NOW } });
  await assert.rejects(bare.client.pools(), { retryAfter: 900 });
});

test('Retry-After: seconds or an HTTP date', () => {
  assert.equal(retryAfterSeconds('30', NOW), 30);
  assert.equal(retryAfterSeconds(new Date(NOW + 60000).toUTCString(), NOW), 60);
  assert.equal(retryAfterSeconds(null, NOW), null);
  assert.equal(retryAfterSeconds('soon', NOW), null);
});
