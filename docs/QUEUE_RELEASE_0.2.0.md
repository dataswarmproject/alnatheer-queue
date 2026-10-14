# Alnatheer Queue 0.2.0 verification

Verified locally on Windows on 2026-10-13. This is an unsigned evaluation release; it has not been installed on Alnatheer's production server or branches.

## Delivered

- Native teller dock, centered expanded view, six actions, current ticket, keyboard labels, topmost behavior and motion/reduced-motion handling.
- Full-screen customer kiosk, room TV and separately assigned counter TV, using Alnatheer's pink logo, bundled licensed fonts and Geist styling.
- Independent branch host/database, device pairing, staff/counter assignment, revocation, server diagnostics and persistent event history.
- WAN-independent branch commands, bounded durable synchronization, idle heartbeats, conflict detection, deduplication and headquarters-restore replay.
- Branch/assigned-teller analytics, ticket journeys, daily local reports and manual JSON export.
- Branch backup archives/manifests and a bundled restore command that requires a new directory.
- SARAF queue inbox, state projections, scoped APIs and headquarters dashboard at `/ar/queue` and `/en/queue`.
- CI checks for queue types, formatting, database/HTTP tests, native Windows workflows, dependency audit and installer output.

## Local evidence

| Check                       | Result                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch/core suite           | 10 files, 26 tests passed against real disposable PGlite databases, including real HTTP synchronization, replay, identity checks and backup/restore                                       |
| SARAF suite                 | 23 files, 170 tests passed; 3 additional dashboard tests passed for retry, missing/stale data and late branch-response cancellation                                                       |
| TypeScript                  | Queue core, branch host, desktop and SARAF passed                                                                                                                                         |
| Migration consistency       | `drizzle-kit check` passed; production migration was not applied                                                                                                                          |
| SARAF Windows build         | `build:local` passed, including queue pages and endpoints; Linux standalone output remains enabled for deployment                                                                         |
| Teller native workflow      | Six actions, completion, transfer/no-show, pause/resume, favorites, expansion and four viewport widths passed without renderer errors                                                     |
| Five native devices         | Kiosk → teller → room TV/counter TV → manager analytics/backup passed; local service continued during simulated HQ outage and events subsequently caught up in a real disposable HQ inbox |
| Printing                    | Test-only driver failed once, retained the same ticket, and succeeded on manual retry; selected printer, silent printing and 58mm width verified                                          |
| Public device authorization | Direct disconnect rejected; teller key rejected for operator unlock; current manager key accepted                                                                                         |
| Packaged Windows runtime    | Bundled provisioning, persistent empty database, authenticated HTTP, real backup and bundled restore into a new folder passed                                                             |
| Queue dependency audit      | No high/critical findings in queue runtime/build paths; one moderate installer-tool `sprintf-js` finding remains                                                                          |

No demo customers, services, tickets, tellers or performance values are automatically inserted by the operational runtime. Test fixtures live under `tests` and are excluded from the installer. The headless packaged startup test confirms an empty operational database.

## Remaining pilot work

Use the [setup guide](QUEUE_DESKTOP.md) for real branch identities, trusted TLS, startup accounts, device keys, paper/print drivers, report/backup directories and private sync keys. Test actual printers/cutters/speakers and device recovery on branch hardware. Public kiosk Windows access policies and signed installer distribution need deployment configuration.

Apply the reviewed additive SARAF migration only after a non-empty PostgreSQL deployment backup; coordinate its journal order with the separate backup-mapping workstream. Existing financial and legacy queue databases stay intact. Queue restore archives are not a SQL Server `.bak` import mechanism. Authenticated production headquarters access and actual WAN/TLS deployment still need verification. Queue AI tools, transaction/revenue links, service-quality surveys and independent attendance feeds are not activated by this release.

Existing SARAF high/critical dependency advisories remain outside this queue change. The audit reports them explicitly instead of claiming a clean workspace. Queue build fixes were checked against the maintainers' advisories for [lodash](https://github.com/advisories/GHSA-r5fr-rjxr-66jc), [brace-expansion](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [Browserslist](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) and [fast-uri](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj). A scoped AJV override uses patched fast-uri 3.1.8; React 18 types are pinned to avoid incompatible duplicate React type trees. No auth/compliance dependency upgrade or production database change is implied.

Connection isolation also passed: re-pairing clears issued-ticket print access and temporary operator grants; late command responses cannot populate another connection.
