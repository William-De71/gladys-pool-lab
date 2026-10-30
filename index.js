// -----------------------------------------------------------------------------
// Entry point of the Pool Lab external integration.
//
// The water tests of a LabCom account (Water-i.d. PoolLab 1.0 / 2.0 and
// PrimeLab photometers), through the official LabCom GraphQL API
// (https://backend.labcom.cloud/graphql) and the personal API token of the
// account, read only:
//   - devices: one per LabCom account (a pool, a spa), one feature per
//     parameter measured and the water balance, offered on the Discovery
//     screen (src/device.js);
//   - scene triggers: new measurement, parameter out of / back in its ideal
//     range, test overdue, access refused;
//   - scene actions: refresh now, last value of a parameter;
//   - dashboard widgets: last test of a pool, history of a parameter.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the times shown by the widgets, the reminder)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Pool Lab integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
