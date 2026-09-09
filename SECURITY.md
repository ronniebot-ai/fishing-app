# Security

## Reporting a vulnerability

Please report security issues through
[private vulnerability reporting](https://github.com/ronniebot-ai/fishing-app/security/advisories/new)
rather than a public issue.

## Scope

Tideline is a client-side application. It has no backend, no accounts, and no
server of its own:

- Forecast data comes from [Open-Meteo](https://open-meteo.com/), which is
  keyless — the app ships no credentials and stores none.
- Map tiles come from OpenStreetMap.
- The only data kept on the device is a `localStorage` cache of which ocean
  grid cell a coordinate snaps to, and the selected spot in the URL. Neither
  is personal data and neither leaves the browser.

The realistic attack surface is therefore the frontend itself and the
dependency tree, which is what the automated scanning below covers.

## Automated scanning

| What | Where | When |
|---|---|---|
| CodeQL (`security-extended` suite) | `.github/workflows/codeql.yml` | Every push and PR to `main`, plus weekly |
| `npm audit` (fails on high/critical) | `.github/workflows/audit.yml` | Every push and PR to `main`, plus weekly |
| Dependabot (npm + github-actions) | `.github/dependabot.yml` | Weekly |

The weekly schedules matter as much as the push triggers: advisories are
published against dependencies that have not changed, so a scan that only runs
on push reports the state at the moment of the push and nothing after it.

## Supported versions

This is a personal project; only `main` is maintained.
