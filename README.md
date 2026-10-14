# Alnatheer Queue · إدارة الانتظار

Private Windows desktop suite owned by Alnatheer Exchange. The repository contains the branch service, manager, teller dock, ticket kiosk, waiting display and counter display. See [the branch manager guide](docs/QUEUE_BRANCH_MANAGER.md) and [the Arabic IT setup and LAN/VPN guide](docs/QUEUE_IT_SETUP_AR.md).

Each branch owns an independent PGlite/PostgreSQL database. Teller and kiosk PCs connect to the branch host over trusted HTTPS on the LAN. The manager drives the customer display over HDMI. Only the branch host synchronizes with SARAF headquarters; WAN outages do not stop branch queue service.

## Development

Use Node 22.19+ and pnpm 10.26.2. Run `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`. On Windows, set `QUEUE_FONT_ARCHIVE` to the owner-supplied Thmanyah archive. Set `QUEUE_VOICE_LIBRARY_DIRECTORY` to the verified free Arabic voice bundle before `pnpm package:win`. Operational databases, pairing keys, raw fonts and release private keys are excluded from Git.

The installer asks which role the PC will use. Set up one branch host, configure real services/counters and issue separate pairing files for each teller and kiosk. Use **شاشات العرض** on the manager for display selection and independent voice/alert settings. Setup, encrypted connections and preferences persist across restarts. A new branch has no fabricated operational records.

## Private releases

The free internal signing workflow is manual and uses an existing Windows PC. Follow [the Digital Trendz internal signing guide](docs/QUEUE_FREE_SIGNING.md) to create a non-exportable local signing key and explicitly deploy its public certificate on approved branch PCs. This establishes internal publisher trust; public SmartScreen reputation remains separate. No paid certificate or signing subscription is configured.

The self-hosted workflow runs only reviewed main, validates formatting/types, real branch tests, runtime audit, native desktop workflows and packaged-runtime qualification. Windows publisher signatures and timestamps must validate before the existing Ed25519 release manifest is signed. Publishing is off by default and requires a matching `queue-vX.Y.Z` tag. The Windows signing key stays in the local signing account; the separate Ed25519 key stays outside Git or in the existing encrypted release secret. Keys cannot be silently rotated.

Licensed font inputs are encrypted in the private `queue-build-inputs` prerelease. CI decrypts them only on the release runner. The free offline Arabic bundle is verified against committed checksums and its recording manifest. Raw font source files are not published as installation assets.

SARAF serves `/api/queue/updates` using a server-only fine-grained GitHub token with Contents:read for this repository. Active registered branches use their existing HQ synchronization key. Clients never receive GitHub credentials and verify signatures and installer hashes themselves. Until the HQ route and credential are deployed, the app reports the source as unavailable and does not offer a fake update.

The 0.4.2 installer is Windows-signed and timestamped as Digital Trendz for a manual internal IT pilot. Windows signatures and the packaged runtime were verified after enrolling trust on the signing account. IT must approve and deploy the included public certificate on branch PCs; public SmartScreen reputation remains separate. The stable 0.4.1 installer remains unsigned. Upgrades preserve existing branch databases and settings and require a verified backup and no open tickets. Teller/kiosk PCs install the release separately.

The initial 0.4.1 installer was built and qualified locally. GitHub reported that the account's Actions budget prevented hosted jobs from starting. The workflow now uses an optional manual self-hosted Windows runner; none has been registered and no billing setting was changed. Existing 0.4.0 evaluation installs require manually installing 0.4.1 once to bootstrap the signed-manifest update path.

## Scope of qualification

Local tests cover ticket printing acceptance/retry, FIFO bounds, six counters, Riyadh midnight reset, backups into separate databases, synchronization recovery, reports, Arabic voice/alert channels, display lifecycle and session persistence. Windows spool acceptance is not physical paper confirmation. Actual thermal printer qualification awaits its model; separate LAN PCs and live HQ upgrades must be qualified at deployment. Annual subscription licensing has not been implemented.

Proprietary project; see [LICENSE](LICENSE).
