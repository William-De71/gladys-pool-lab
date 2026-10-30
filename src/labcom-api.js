// -----------------------------------------------------------------------------
// Client of the LabCom cloud, the official API of the Water-i.d. PoolLab 1.0 /
// 2.0 and PrimeLab photometers: one GraphQL endpoint,
//
//   POST https://backend.labcom.cloud/graphql
//   Authorization: <the personal API token of the account, as is, no "Bearer">
//   Content-Type: application/json          body { query, variables }
//
// (the console is https://backend.labcom.cloud/graphiql, linked from the
// LabCom web app). The token is created by the user on
// https://labcom.cloud/pages/user-setting. Read only: the integration sends a
// single query, never a mutation.
//
// The query (field names from the published schema, the one the Home
// Assistant client dala318/python_poollab (MIT) fetched): the cloud account,
// its accounts (a LabCom "account" is a sampling point: a pool, a spa) and
// their measurements, from a date (the `from` argument, Unix seconds) or all
// of them. Types of the schema: ids are Int, `timestamp` is an Int (Unix
// seconds), `value`, `ideal_low`, `ideal_high` and `ideal_status` are
// Strings; parse.js accepts numbers too.
//
// Errors (checked live on 2026-10-30 without a token: HTTP 403 with an HTML
// "Forbidden" page, not JSON):
//   - 401 / 403                 the token is refused (`auth`);
//   - 429                       wait (Retry-After, 15 minutes by default);
//   - 5xx, a body that is not JSON   `server`;
//   - a GraphQL `errors` array  `auth` when it speaks of the token or the
//                               authorization, else `graphql`;
//   - no answer                 `unreachable`.
//
// Pace: no documented quota. One request at a time; the app reads at the
// interval of the configuration (15 minutes by default), and the full history
// window only every 6 hours.
// -----------------------------------------------------------------------------

const API_URL = 'https://backend.labcom.cloud/graphql';
const TIMEOUT_MS = 30000;
const DEFAULT_PAUSE_MS = 15 * 60 * 1000;
const MIN_PAUSE_MS = 60 * 1000;
const MAX_PAUSE_MS = 6 * 60 * 60 * 1000;

const ACCOUNT_FIELDS =
  'id forename surname street zipcode city country volume volume_unit pooltext';
const MEASUREMENT_FIELDS =
  'id scenario parameter parameter_id unit comment device_serial value formatted_value ideal_low ideal_high ideal_status timestamp';

/**
 * @description The query of the accounts and their measurements.
 * @param {boolean} withFrom - Whether the measurements start at `$from`.
 * @returns {string} The GraphQL query.
 */
function poolsQuery(withFrom) {
  return [
    `query PoolLab${withFrom ? '($from: Int)' : ''} {`,
    '  CloudAccount {',
    '    id',
    '    last_change_time',
    '    Accounts {',
    `      ${ACCOUNT_FIELDS}`,
    `      Measurements${withFrom ? '(from: $from)' : ''} {`,
    `        ${MEASUREMENT_FIELDS}`,
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
}

/**
 * @description An error of the LabCom API.
 */
class LabcomError extends Error {
  /**
   * @param {string} kind - `auth` (token missing or refused), `rate_limit`,
   * `server`, `graphql`, `unreachable`, `failed`.
   * @param {string} message - What went wrong (never the token).
   * @param {object} [extra] - `{ status, code, retryAfter }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'LabcomError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description The seconds of a Retry-After header (a number or an HTTP date).
 * @param {string|null} header - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Seconds, null when absent or unreadable.
 */
function retryAfterSeconds(header, now) {
  if (header === null || header === undefined || header === '') {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : null;
}

/**
 * @description Whether GraphQL errors speak of the token or the authorization.
 * @param {object[]} errors - The `errors` of the answer.
 * @returns {boolean} True for a refused token.
 */
function isAuthError(errors) {
  return errors.some((error) => {
    const code = String(error?.extensions?.code ?? error?.extensions?.category ?? '');
    const message = String(error?.message ?? '');
    return /unauth|forbidden|authori[sz]|authentic|token|permission|access denied/i.test(
      `${code} ${message}`,
    );
  });
}

/**
 * @description The LabCom client.
 * @param {object} options - Options.
 * @param {Function} options.getToken - `() => string`, the API token ('' when none).
 * @param {string} options.userAgent - The User-Agent of every request.
 * @param {Function} [options.fetch] - The fetch implementation (tests).
 * @param {string} [options.url] - The endpoint (tests).
 * @param {Function} [options.now] - `() => number` in ms.
 * @returns {object} The client.
 */
function createLabcomClient({
  getToken,
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  url = API_URL,
  now = () => Date.now(),
}) {
  let chain = Promise.resolve();
  let pausedUntil = 0;
  let requests = 0;
  let failures = 0;

  /**
   * @description Run a function in the queue: one request at a time.
   * @param {Function} run - `() => Promise`.
   * @returns {Promise<*>} Its result.
   */
  function queued(run) {
    const result = chain.then(run);
    chain = result.catch(() => {});
    return result;
  }

  /**
   * @description Send one GraphQL query.
   * @param {string} query - The query.
   * @param {object} [variables] - Its variables.
   * @returns {Promise<object>} The `data` of the answer.
   */
  async function send(query, variables) {
    const token = String(getToken() ?? '').trim();
    if (!token) {
      throw new LabcomError('auth', 'No LabCom API token', { code: 'missing' });
    }
    if (pausedUntil > now()) {
      throw new LabcomError('rate_limit', 'LabCom asked to wait (429)', {
        retryAfter: Math.ceil((pausedUntil - now()) / 1000),
      });
    }
    requests += 1;
    let response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: {
          authorization: token,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': userAgent,
        },
        body: JSON.stringify(variables ? { query, variables } : { query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      failures += 1;
      throw new LabcomError('unreachable', `LabCom unreachable: ${err.message}`);
    }
    const text = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      failures += 1;
      throw new LabcomError('auth', `LabCom refused the API token (HTTP ${response.status})`, {
        status: response.status,
        code: 'refused',
      });
    }
    if (response.status === 429) {
      failures += 1;
      const seconds = retryAfterSeconds(response.headers?.get?.('retry-after') ?? null, now());
      const pause =
        seconds === null
          ? DEFAULT_PAUSE_MS
          : Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, seconds * 1000));
      pausedUntil = now() + pause;
      throw new LabcomError('rate_limit', 'LabCom asked to wait (429)', {
        status: 429,
        retryAfter: Math.ceil(pause / 1000),
      });
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (response.status >= 500 || !body || typeof body !== 'object') {
      failures += 1;
      throw new LabcomError(
        'server',
        `LabCom answered HTTP ${response.status}${body ? '' : ' without JSON'}`,
        { status: response.status },
      );
    }
    const errors = Array.isArray(body.errors) ? body.errors : [];
    if (errors.length && isAuthError(errors)) {
      failures += 1;
      throw new LabcomError('auth', 'LabCom refused the API token', { code: 'refused' });
    }
    if (!response.ok) {
      failures += 1;
      throw new LabcomError('failed', `LabCom answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    if (!body.data || typeof body.data !== 'object') {
      failures += 1;
      const message = String(errors[0]?.message ?? 'no data').slice(0, 200);
      throw new LabcomError('graphql', `LabCom GraphQL error: ${message}`);
    }
    // Partial data with errors: the data is used, the errors are reported.
    return { data: body.data, errors: errors.map((e) => String(e?.message ?? '').slice(0, 200)) };
  }

  return {
    /**
     * @description The cloud account, its accounts and their measurements.
     * @param {object} [options] - `{ from }`: Unix seconds, the oldest
     * measurement wanted (absent: every measurement).
     * @returns {Promise<{ cloud: object, errors: string[] }>} The raw `CloudAccount`.
     */
    pools({ from } = {}) {
      return queued(async () => {
        const withFrom = Number.isInteger(from);
        const { data, errors } = await send(poolsQuery(withFrom), withFrom ? { from } : undefined);
        if (!data.CloudAccount || typeof data.CloudAccount !== 'object') {
          throw new LabcomError('graphql', 'LabCom gave no cloud account');
        }
        return { cloud: data.CloudAccount, errors };
      });
    },
    /**
     * @description Until when LabCom asked to wait (0: no pause).
     * @returns {number} Ms.
     */
    pausedUntil: () => (pausedUntil > now() ? pausedUntil : 0),
    /**
     * @description The counters, for the diagnostic.
     * @returns {{ requests: number, failures: number }} The counts.
     */
    counts: () => ({ requests, failures }),
  };
}

export { API_URL, LabcomError, poolsQuery, retryAfterSeconds, isAuthError, createLabcomClient };
