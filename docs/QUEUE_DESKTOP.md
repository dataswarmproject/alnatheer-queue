# Alnatheer queue desktop

## Approved direction

The teller uses an installed Windows application: a narrow, black, curved left-edge dock with the current ticket, six Iconoir actions, and a detached expand button. The expanded view provides call-next, transfer, completion, queue visibility and connection settings. Counter pause is distinct from a ticket's service state. Favorites bookmark services, never alter customer priority.

One background branch host owns one local PostgreSQL-compatible database, shared by branch devices through a scoped API. The first implementation embeds PostgreSQL using PGlite on the host filesystem; no database is stored in a teller renderer. It works without WAN connectivity. A durable event outbox uploads to SARAF; SARAF stores an independent event inbox, validates branch identity, rejects gaps and deduplicates retries. Existing financial tables and queue records are preserved.

## Structure and implementation sequence

- `packages/queue-core`: validated command, snapshot and synchronization contracts.
- `services/queue-branch`: local database, atomic commands, device authorization, independent HTTP service and synchronization worker.
- `apps/queue-desktop`: Electron shell, isolated preload bridge, bundled Arabic React UI and Windows packaging.
- SARAF `/api/queue/sync`: authenticated branch inbox, additive migration and scoped read API.

Start with persistent queue commands and tests; add synchronization tests; then build the native dock and exercise the complete workflow. No demo customers or tickets are inserted automatically. Tests use disposable databases.

## Acceptance criteria

1. Branch host survives teller exit. One active ticket per counter; tickets cannot be claimed twice. Commands carry request IDs and expected counter revisions.
2. Recall preserves first call time. Transfers retain ticket code and record immutable events. No-show applies only before service starts; service completion is explicit.
3. Pause blocks call-next and changes to resume. Disabled and disconnected actions cannot mutate data. Restarts preserve tickets, state and pending synchronization events.
4. All six actions, current ticket and expand/collapse work with keyboard labels. Native compact window stays above exchange software without covering the full screen; expanded content is bounded and scrollable.
5. Desktop renderer cannot access secrets, Node, arbitrary IPC, URLs, filesystem or shell. Device credentials are stored through OS encryption in the main process.
6. Device keys identify a role and counter; teller cannot control another counter. LAN access requires TLS, except loopback development.
7. Sync is opt-in, uses HTTPS, sends bounded ordered batches and acknowledges only committed events. Losing WAN does not block local commands. A restored old database fails closed on sequence conflicts.
8. No writes to SARAF operational/financial records. Management can inspect synchronized events with fresh server-side branch permissions.

## Commands

Install with `pnpm install --ignore-scripts`. Reviewed Electron installation is run explicitly after inspecting its install script. Build with `pnpm --filter @saraf/queue-desktop build` and `pnpm --filter @saraf/queue-branch build`; tests with `pnpm --filter @saraf/queue-branch test`; desktop with `pnpm --filter @saraf/queue-desktop start`.

TypeScript is strict; inputs use Zod at boundaries and SQL parameters at persistence boundaries. Tests cover actual isolated databases and real HTTP/native workflows. Secrets, branch databases and installer output are ignored by Git. Production signing, printer/audio hardware qualification and multi-branch rollout require deployment verification.

## Design and branding

The desktop uses the official [Geist](https://vercel.com/geist/introduction) dark color scale, neutral surfaces, 6px controls, 36px standard buttons, text tabs, heading hierarchy and blue focus ring. Geist Sans and Mono 1.7.2 are bundled with their OFL license for offline use. The existing supplied Alnatheer font covers Arabic glyphs. The curved dock remains a custom shell with six Iconoir actions. Company branding uses the existing `apps/web/public/natheer-logo.png` pink-and-silver logo, copied without recoloring; layout uses `object-fit: contain`.

## Windows branch setup

The **0.4.2** Windows installer is signed and timestamped as Digital Trendz for a manual internal IT pilot. IT must approve its included public signing certificate on managed PCs. The stable **0.4.1** installer remains unsigned. Version 0.4.2 adds clearer branch-ID setup, an explicit local-evaluation ID option, file browsing, Windows enterprise-certificate trust and corrected subsecond counter metrics. Use the same tested version on the branch host, tellers and ticket kiosk. Follow [the Arabic IT setup and LAN/VPN guide](QUEUE_IT_SETUP_AR.md) and [the free internal signing guide](QUEUE_FREE_SIGNING.md). The application includes a separate branch-host runtime under its installation folder's `resources/branch`; the teller does not own the database. The free Arabic recording library covers A1–A999 and counters 1–10; the display supports at most six configured counters in one column. Preparation uses a GPU, but installed playback requires no GPU or subscription. Voice remains off by default pending pronunciation improvements; the manager controls voice and alert sound independently. New host setup installs the cache automatically. Existing running branch services must restart during maintenance to load a new voice profile; the update preserves their database and older voice files.

### Guided first-run setup

The Windows installer copies the application; **the role choices appear on first launch**. Existing paired installations keep their role. Choose teller, ticket kiosk, branch management, HDMI television, or branch server. Independent room/counter-display PCs remain available under advanced choices. Selecting a role does not grant permissions: the host verifies the pairing key, and mismatched keys are rejected before they are saved.

For an existing branch host, choose the device role and import its private pairing JSON or enter the server address and key. The manager can save a pairing file immediately after issuing a device key. Treat that file as a credential and deliver it only to its assigned device. Stored connection credentials are encrypted using the Windows account.

For a new host, choose **branch server**, enter the actual SARAF branch UUID and select a new empty local folder. The wizard provisions one manager, creates an empty persistent database, configures report/backup folders, starts an independent background process, and connects the manager UI without requiring command entry. It refuses occupied folders, an existing saved host, and an occupied port. Existing data is never replaced or deleted. If host startup or connection verification fails after creation, use **resume setup**; the created database and encrypted configuration are preserved.

The default host mode serves only this computer. Expand the branch-network settings to choose this PC's LAN address, the HTTPS URL/port, and trusted TLS certificate/key files. IT must provision certificate trust and the branch-scoped firewall rule; the wizard does not bypass certificate checks or broadly open the firewall. Optional headquarters URL/sync key are stored in the encrypted host configuration. The host needs a stable address and correct clock. Restrict a chosen data/report/backup folder to the operating account and administrators.

The installed Windows wizard offers **start the server when signing into Windows**. This uses the same account's login-start entry and starts the headless host. It is logon startup, not a Windows service or startup before sign-in. The database process survives closing the management UI. Opening the manager again reuses the existing host. For a service-account/startup-at-boot deployment, use the Task Scheduler procedure below.

### Manager-connected HDMI television

Connect the room TV to the manager PC by HDMI and choose **Extend** using Windows **Win + P**. Use the **HDMI television** setup option with a manager key, or open **HDMI TV** in an already-paired manager. Select the second monitor and start the display. A separate full-screen window shows the room queue there while the manager controls remain on the main monitor. No TV installer or network pairing is required on a television connected by cable.

The TV window uses an independently issued display-only device key; its IPC cannot call staff actions, export pairing files, change connections, create servers or quit the manager. Closing the TV revokes its key when the branch is reachable. Unplugging the selected monitor closes the TV window. A canceled opening cannot reappear on a late server response. The manager can stop the local TV even while the branch connection is offline. Closing the manager application closes its HDMI window; the independent branch server continues. The manager restarts the HDMI view after reopening. In Duplicate mode Windows may report one logical display: use Extend to keep management private.

Choose the television as the Windows sound output. The manager's **شاشات العرض** panel controls the display and independent voice/alert channels; customer screens show no settings. Keep voice off until the next approved voice version. Actual cable routing, audio, display scaling and kiosk printer hardware require branch verification. Automated HDMI tests emulate a second-monitor inventory while running real native windows and branch commands.

### Arabic spoken announcements

The screen speaks `التذكرة رقم إيه، ثلاثة وعشرين. يُرجى التوجّه إلى الكاونتر رقم ستة وثلاثين.` for ticket `A-023` routed to a counter named `كاونتر 36`. It preserves the ticket prefix, reads numbers as Arabic words, and recognizes Arabic/Persian/English counter digits. The displayed/printed number stays unchanged. A counter without a number is announced by its configured name; its position or UUID is never treated as a number.

The installer includes a generated free offline voice library; no paid voice key is needed. The 10-counter/999-ticket plan covers 9,990 combinations with 1,009 phrase recordings plus one test. Voice is deliberately off by default in source 0.4.2 because the current pronunciation was not approved. The older [natural voice setup](QUEUE_VOICE_0.3.2.md) and [voice comparison](QUEUE_VOICE_RESEARCH.md) describe optional provider preparation, not a requirement for branch setup. Do not activate paid voice generation during deployment.

An optional device-voice mode is available from manager settings. Installing an Arabic Windows voice does not guarantee acceptable pronunciation. Use the manager's test controls only during a planned audition; leave live voice disabled until it is approved. Tests do not issue tickets. Do not add controls to the customer display.

Calls are read one at a time, recalls have their own event sequence and repeat the message, regular refreshes do not repeat calls, and mute cancels queued speech. Initial connection does not replay previous calls. Queued calls older than 30 seconds or no longer active are skipped; the pending list is bounded. Speech-engine errors mute the announcement and display recovery guidance. Hardware speech quality/volume/output still requires a branch test; automated native tests simulate the speech engine while verifying real branch calls and recalls.

1. Choose one always-on branch PC and a private persistent folder, for example `D:\AlnatheerQueue\data`. Restrict the data, report, certificate and pairing folders to the designated service account and administrators.
2. Use the real SARAF branch UUID for headquarters synchronization. A local evaluation can use a separate UUID, but it will not synchronize until it matches an active SARAF branch. Never change an existing database's branch identity.
3. Stop any existing branch host before provisioning the initial manager. In PowerShell, from the installed `resources\branch` folder:

```powershell
.\queue-setup.cmd --directory 'D:\AlnatheerQueue\data' --branch '<branch-uuid>' --output 'D:\AlnatheerQueue\manager.queue-pairing.json'
$env:QUEUE_BRANCH_ID = '<same-branch-uuid>'
$env:QUEUE_DATA_DIR = 'D:\AlnatheerQueue\data'
$env:QUEUE_LISTEN_HOST = '127.0.0.1'
$env:QUEUE_LISTEN_PORT = '4318'
$env:QUEUE_REPORT_DIR = 'D:\AlnatheerQueue\reports'
$env:QUEUE_BACKUP_DIR = 'D:\AlnatheerQueue\backups'
.\queue-host.cmd
```

4. Open Alnatheer Queue and enter the local service URL and manager key from that private pairing file. Do not paste keys into chat or Git. Configure the actual branch services and counters in Settings, then issue separate device keys for the kiosk, each teller and displays. Each active teller device is assigned to one counter and staff reference. Finish the current customer before revoking an old teller assignment for a shift change.
5. To share the host across PCs, use a DNS name and a TLS certificate trusted by those PCs. Set `QUEUE_LISTEN_HOST` to the branch LAN interface, `QUEUE_TLS_CERT` and `QUEUE_TLS_KEY` to private certificate/key paths, and allow only the selected port from the branch network. Point devices to `https://<branch-host>:4318`. Do not bypass certificate checks.
6. Copy `queue-start.cmd.example` to a private service-account folder, change the install path, branch UUID and connection settings, and run that launcher using Windows Task Scheduler at startup. Disable parallel task instances and enable restart on failure. Teller app exit does not stop the host. The host recovers a dead local process lock automatically; foreign-machine, foreign PID-namespace and corrupt locks fail closed. Before manually removing a lock, verify the exact directory and that no host anywhere still owns it. Never run two hosts over one folder or share a database folder between machines/containers.

For development, the equivalent commands are `pnpm --filter @saraf/queue-branch setup --directory <absolute-folder> --branch <uuid> --output <private-file>`, then `pnpm --filter @saraf/queue-branch dev` with variables set; `pnpm --filter @saraf/queue-desktop start` opens the native app. No operational customers, tickets or performance data are seeded.

## Connecting headquarters

Deploy the reviewed branch code to SARAF through the normal Git workflow. Before applying additive migration `0013_queue_sync.sql`, the existing deployment script must produce a non-empty PostgreSQL backup. This migration adds independent queue inbox tables and indexes; it does not overwrite financial or old queue tables. Migration 0012 is intentionally reserved for the existing backup-mapping workstream; check migration order when merging those features.

Generate one private random 32-byte hex sync key per branch using a secure local key tool. SARAF receives only its SHA-256 hash in `QUEUE_BRANCH_KEY_HASHES`, a JSON map of `{ "<branch-uuid>": "<sha256-hex>" }`. The branch host receives the raw key in `QUEUE_SYNC_KEY` and the HTTPS endpoint in `QUEUE_SYNC_URL=https://<saraf-host>/api/queue/sync`. This is distinct from device pairing keys. Keep configuration out of version control. Restart the two services after configuration.

The host uploads at most 100 ordered immutable events and 240KB per batch, then sends an idle heartbeat every ten seconds. Failures retry with backoff up to one minute. Queue commands use the local database while headquarters is unavailable. Headquarters commits inbox events and current ticket/counter projections together; identical retries do not duplicate records. Event history is retained. If headquarters was restored to an earlier point, a heartbeat requests replay of that retained history. If a branch was restored behind headquarters, synchronization rejects the divergent history: reconcile before opening that restored branch for new work; never reset sequence numbers.

The installed branch manager sees database readiness, enabled devices, pending events, last headquarters contact, configured reports, backup status and manual backup creation under **الخادم**. `/healthz` returns only minimal unauthenticated readiness; diagnostics and backup operations require an authorized manager.

SARAF's `/ar/queue` dashboard shows authorized branches, synchronized counter state, waiting counts, teller performance and report export. It refreshes every 15 seconds, labels missing/stale heartbeat data, and never invents values for branches with no events. APIs include `/api/queue/branches`, `/api/queue/state`, `/api/queue/events` and `/api/queue/analytics`. Fresh active-user permissions require both branch and report access; cross-branch viewing needs explicit `branches:view_all`. The assistant recognizes the section, but no queue-analysis AI tool or automated headquarters actions have been activated in this release.

## Customer kiosk, room TV and counter TV

Pair the ticket kiosk using a dedicated kiosk key. It runs in an opaque native full-screen window, offers active services, issues a durable ticket before printing, and displays the receipt. Configure an installed Windows printer, 58mm/80mm paper, automatic printing and return delay in **إعدادات الجهاز**. Automatic printing requires a selected available printer. Printer failure retains the issued ticket; retry printing the same receipt instead of issuing a new ticket. A successful native print callback confirms submission to the driver, not physical output. No ESC/POS cutter or cash-drawer command is sent.

The printed ticket uses the actual company logo in thermal monochrome, bundled offline fonts, a prominent unchanged queue code, one Arabic service name and an optional configured English name. Set that English name in the manager's service settings; it is not generated or translated automatically. The timestamp uses the ticket's server-issued time in Riyadh, with a Gregorian date and 24-hour clock. Native printing measures the rendered content after fonts/images load and requests a matching paper length instead of a fixed 140mm page. Long service labels wrap; long queue codes fit within the paper width. Upgrade the host and all clients together when enabling English service metadata. No new SQL migration is needed because service labels are stored in the existing configuration JSON.

A display key without a counter assignment provides a full-screen room view with the current call and all configured counters and their current tickets, including idle/paused states. Ten counters fit without scrolling; larger sets rotate in pages. The current call panel turns white with logo-pink text; other cards remain dark. Assign a display key to a specific counter for a single-counter number screen. Calls route by counter and ticket UUID, even when names match. The clock uses Riyadh time; stale local data is clearly labelled when the branch connection drops. Enable announcements locally once using natural cached audio or the explicit local Arabic voice mode; old calls are not replayed after reconnecting. Hardware kiosk auto-start/audio activation remains part of the pilot.

Customer screens require a current manager key to open device settings for two minutes. The key is verified against the branch and never saved as an operator credential. Closing settings locks them again. Unauthorized renderer calls cannot disconnect or change printer configuration, and customer windows cannot switch into the teller dock. Use Windows device policies to restrict OS-level access on public kiosk PCs.

## Database backup and restore

Ticket numbering starts again at `001` for each service at **00:00 Saudi time (`Asia/Riyadh`, UTC+3)**, independently in each branch. The next issued ticket automatically uses the new day's persistent sequence; no scheduled job, internet connection or application restart is needed. The branch host's clock must be correct. Issuance date and numbering date use the same timestamp, including requests crossing midnight. Existing waiting and active tickets retain their numbers and FIFO position; history, ticket UUIDs and synchronization event sequences are preserved. A retry of a previously issued ticket returns that original ticket even after midnight. Numbers may repeat across days, so ticket lookup uses the date and identity. Restarting the host continues the current day's numbering rather than resetting it again.

Each branch owns its own local data directory. Configure `QUEUE_BACKUP_DIR` outside that directory; the host saves one backup at startup/per Riyadh day and supports additional manager-requested backups. Archives have unique names, private permissions and a manifest containing branch UUID, engine version, size, SHA-256 and creation time. No archive is automatically deleted. Backups contain device authorization hashes and full queue history, so restrict access and retain a copy on separate storage under company policy.

Restore a trusted archive together with its matching `.manifest.json` into a **new, nonexistent directory**. Keep the old database intact. From installed `resources\branch`:

```powershell
.\queue-restore.cmd --archive 'D:\AlnatheerQueue\backups\<archive>.pgdata.tar.gz' --directory 'D:\AlnatheerQueue\restored-2026-10-13' --branch '<same-branch-uuid>'
```

The restore tool verifies checksum, size, engine version and database branch identity. It removes only the imported source-process lock in the newly created target. Stop the old host, preserve its directory, then explicitly switch `QUEUE_DATA_DIR` to the verified target; do not run old and restored hosts simultaneously. Check synchronization before admitting new customers. These archives restore this PGlite queue database; they are **not** SQL Server `.bak` files or a general SARAF financial-data import mechanism.

## Performance evidence and reports

Management can inspect arrivals, completed visits, first-service waiting time, P90, sample sizes, recall/transfer/no-show events, service duration by assigned teller and service, counter availability/utilization, Riyadh hourly arrivals, optional SLA adherence, and exact ticket journeys. Definitions and coverage warnings accompany the report. Local and headquarters calculations share the same event loader and calculation code.

Manual JSON export uses a native save dialog. With `QUEUE_REPORT_DIR`, the host exports the completed Riyadh business day after midnight and after restart, retries failed writes, and preserves existing report files. This exports the previous completed day; it does not backfill every missed day automatically. Retain reports in a private folder with the branch retention policy.

Staff attribution is the assigned device and staff reference captured with each event. It is not a biometric or individual login attendance measure. Counter utilization is not employee attendance; speed alone does not prove service quality. Transaction complexity/revenue, compliance outcomes, customer feedback and independent shift attendance require genuine source integrations before reporting them. There are no invented scores, forecasts or benchmark targets.

## Pilot verification remaining

Verify the physical printer, paper/cutter and speakers; automated tests simulate a print driver and do not submit a real hardware job. Verify kiosk auto-start, display hardware, TLS trust, signed release distribution, deployment permissions and authenticated headquarters workflows in a non-production branch pilot. Local database backup/restore and WAN-outage recovery are tested on disposable real databases and native devices. No production migration or branch installation is implied by these local tests.

The release audit checks both queue runtime and build-tool paths. Compatible dependency fixes remove queue high/critical findings; a moderate `sprintf-js` finding remains in the installer download/proxy logging toolchain, with no patched version supplied by the audit. Build using trusted proxy/configuration/format strings. Existing SARAF high/critical advisories remain and require their own remediation before production rollout. The global React 18 type pin prevents incompatible React type copies after removing the unused Next-dependent font package. All fonts remain bundled with licenses for offline use.

## Empty native dock preview

Run `pnpm --filter @saraf/queue-desktop preview:dock` to open the actual native dock with a disposable in-memory branch and no tickets. This local UI preview does not connect to SARAF or change an operational database. Close the dock from its expanded window to stop the preview.

The compact dock is a topmost Windows window, excluded from the taskbar and protected from minimization. Expanding opens a centered 560 by 620 control panel on the current monitor work area, bounded by the display size; collapsing restores the left-edge dock. Both views share the same six command controls.

View switching uses a short native fade and a subtle renderer scale transition. Native and renderer modes are synchronized; actions are disabled during the transition, interrupted transitions converge to the latest requested mode, and system reduced-motion preferences skip the animation.
