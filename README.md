# Alnatheer Queue · إدارة الانتظار

Private Windows desktop suite owned by Alnatheer Exchange. The repository contains the branch service, manager, teller dock, ticket kiosk, waiting display and counter display. See [the branch manager guide](docs/QUEUE_BRANCH_MANAGER.md).

Each branch owns an independent PGlite/PostgreSQL database. Teller and kiosk PCs connect to the branch host over trusted HTTPS on the LAN. The manager drives the customer display over HDMI. Only the branch host synchronizes with SARAF headquarters; WAN outages do not stop branch queue service.

## Development

Use Node 22.16+ and pnpm 10.26.2. Run `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`. On Windows, set `QUEUE_FONT_ARCHIVE` to the owner-supplied Thmanyah archive. Set `QUEUE_VOICE_LIBRARY_DIRECTORY` to the verified free Arabic voice bundle before `pnpm package:win`. Operational databases, pairing keys, raw fonts and release private keys are excluded from Git.

The installer asks which role the PC will use. Set up one branch host, configure real services/counters and issue separate pairing files for each teller and kiosk. Use **شاشات العرض** on the manager for display selection and independent voice/alert settings. Setup, encrypted connections and preferences persist across restarts. A new branch has no fabricated operational records.

## Private releases

Push a reviewed `queue-vX.Y.Z` tag whose version matches all three packages. CI runs formatting, types, real branch integration tests, runtime audit, Windows desktop workflows and packaged-runtime qualification. Only a passing release build signs `queue-release.json` and publishes the Windows installer. Release signatures use a pinned Ed25519 public key; the private signing key is an encrypted release secret. It must be backed up securely and cannot be silently rotated.

Licensed font inputs are encrypted in the private `queue-build-inputs` prerelease. CI decrypts them only on the release runner. The free offline Arabic bundle is verified against committed checksums and its recording manifest. Raw font source files are not published as installation assets.

SARAF serves `/api/queue/updates` using a server-only fine-grained GitHub token with Contents:read for this repository. Active registered branches use their existing HQ synchronization key. Clients never receive GitHub credentials and verify signatures and installer hashes themselves. Until the HQ route and credential are deployed, the app reports the source as unavailable and does not offer a fake update.

A Windows code-signing certificate is not configured. Signed release manifests provide application-level release verification; initial Windows installation can still show an unknown publisher. Upgrades preserve existing branch databases and settings and require a verified backup and no open tickets. Teller/kiosk PCs currently install the release separately.

## Scope of qualification

Local tests cover ticket printing acceptance/retry, FIFO bounds, six counters, Riyadh midnight reset, backups into separate databases, synchronization recovery, reports, Arabic voice/alert channels, display lifecycle and session persistence. Windows spool acceptance is not physical paper confirmation. Actual thermal printer qualification awaits its model; separate LAN PCs and live HQ upgrades must be qualified at deployment. Annual subscription licensing has not been implemented.

Proprietary project; see [LICENSE](LICENSE).
