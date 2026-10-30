# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- **pools:** every LabCom account (a pool, a spa) of the user, through the official LabCom GraphQL API with a personal API token, read only; every measurement the first time, then the last week of measurements every 15 minutes by default and the last 400 days every 6 hours, kept in `/data`
- **devices:** one device per pool, one feature per parameter measured (pH, free, total and combined chlorine, bromine, active oxygen, hydrogen peroxide, chlorine dioxide, ozone, PHMB, cyanuric acid, alkalinity, calcium and total hardness, salt, phosphate, water temperature, redox and the others) with the value of its last measurement, and the water balance (what is out of its ideal range)
- **scenes:** triggers on a new measurement, a parameter out of its ideal range or back in it, a water test overdue and a refused token; actions to refresh now and to read the last value of a parameter with its ideal range
- **widgets:** the last test of a pool, each parameter colored by its ideal range, with a Refresh button; the history of one parameter over 30, 90 or 365 days with its ideal range
- **configuration:** API token with a guide, reading interval, test reminder delay, language, "Test the connection" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README
