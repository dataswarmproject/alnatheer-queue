# Branch manager 0.4.1

## Branch topology

The manager computer can run the branch host and its independent local PGlite database. Teller computers and ticket kiosks connect to that host through the branch LAN. Each device gets a separate role-scoped pairing key. The customer TV is connected to the manager by HDMI in Windows Extend mode; the manager chooses the second monitor, starts/stops the display and controls voice and alert independently, volume and announcement testing. An optional independent display computer can also pair over LAN, but HDMI needs no TV network connection or separate installation.

Use a fixed LAN host address or local DNS name with a TLS certificate trusted by the branch PCs. Select the host's network address, public HTTPS root URL, certificate and private key in server setup. Keep the private key on the host; install only the public certificate/issuing CA trust on clients. Loopback is for one-computer testing, not teller/kiosk LAN access. Only the branch host synchronizes with SARAF headquarters over HTTPS. Internet loss leaves LAN ticket service working and events queued for acknowledgement.

## Configuration and devices

A new installation contains no operational sample records. In **الإعدادات**, add an active service and save it with the first counter; it starts paused. **الكاونترات** creates/edits up to six counters, assigns services, controls reception/recalls and opens per-counter analysis. Pair a teller with its counter and named employee/staff reference before resuming reception. Never share one teller key between staff: that loses performance attribution.

In **الإعدادات**, create teller, kiosk, independent TV/counter display or additional manager device keys. Save the pairing file and import it through the receiving app's setup. A kiosk sets its printer locally. Revocation disables future access, does not delete history and is blocked when doing so would strand an active service. Counter deletion retires records and revokes attached keys; active and last-counter deletion are blocked.

The manager uses a normal Windows frame with minimize, maximize and close controls. Its window is not always on top. The teller has its own transparent, always-on-top dock on a different workstation; the expanded teller view opens centered on that workstation. Closing the manager also closes its HDMI display, while a separately running branch host continues to serve LAN devices.

## Printed tickets and kiosk recovery

New tickets issued by the desktop kiosk or manager require print acceptance before a teller can call them. A failed print keeps the same number and prevents the kiosk from starting another customer. After Windows accepts the print job, the issuing device records an idempotent `printed` event; a network retry within that app session retries acknowledgement without printing another copy. A pending receipt survives app/host restarts and is recovered only by its issuing device. A restart after an accepted print but before acknowledgement may require printing the same receipt again; it never creates another queue number.

Call-next selects an eligible, already issued waiting ticket transactionally. An empty queue returns `EMPTY` without changing the counter revision or ticket sequence. Print acceptance means Windows accepted the job, not proof that paper came out; paper-out/jam detection depends on the actual thermal printer and driver. Historical tickets and older API issuance without the new flag remain callable for compatibility. Upgrade SARAF's receiver first to accept the optional ticket fields and `printed` event, then upgrade the branch host and clients together. Pending print receipts remain visible to the manager as **بانتظار الطباعة** and block maintenance like other open tickets.

## Database, backups and synchronization

**إدارة النظام** shows health/version, current device count, pending sync, last HQ connection and last backup. It also provides a database integrity check with actual row counts, maintenance/VACUUM after a verified backup, saved sync endpoint/key replacement, manual sync retry, daily backup and daily report switches. Keys are never returned to the UI; an empty replacement field preserves the saved key. The operational config file is private and excluded from Git/backups; protect its host directory with owner/service-account ACLs.

Backup verification checks branch identity, size and SHA-256. Restore creates a new database directory under `restores/`; it never replaces the live database. Reconcile its event sequence with HQ before activating it, using the existing restore/replay procedure. Activation is deliberately an operator recovery procedure, not a destructive GUI swap. No automatic deletion or retention purge has been added.

Maintenance and update installation obtain a manager lease only with no waiting/called/serving tickets. Ticket writes, device changes and configuration changes are blocked during that lease. Reads remain available. Shutdown rejects new requests, drains workers/requests and closes the database before the owned process disappears.

## Reports and dates

**الأداء والتقارير** generates branch, teller, counter, service and hourly analysis for today/7/30 days, including waits/P90, service duration, utilization, recalls, transfers, no-shows, service mix and coverage. Export the full branch report as PDF, UTF-8 CSV or JSON. The CSV uses one row per metric, with stable record identity/unit columns, suitable for spreadsheet pivots. PDF caps a section at 200 rows and labels truncation; CSV/JSON retain the full bounded analysis. Partial coverage, missing starts, attribution limits and absent samples remain visible. These metrics describe recorded service activity, not transaction profit or a complete staff productivity score.

Daily reports persist the previous Riyadh business day's JSON automatically after midnight and after restart. Historical reports are stored in the private host report directory shown in **إدارة النظام**. The runtime does not email/publish reports. Ticket numbering resets at midnight Asia/Riyadh while history remains intact.

Gregorian and Hijri dates use Asia/Riyadh and the Umm al-Qura calendar, on manager/teller headers, kiosk, HDMI TV, printed tickets and PDF reports. Thmanyah Sans replaces all visible UI and number fonts; Geist supplies the component/color/spacing hierarchy, with Alnatheer's pink logo and the approved dock retained.

## Updates and release activation

The manager footer shows the installed version and opens update actions: check, download, verified install, schedule in Riyadh time, cancel schedule or ignore that specific version. Checks run after startup and every four hours while a manager is connected. Scheduling requires the manager app to remain running. It waits for no open tickets, verifies a backup, stops an owned local host, confirms PID exit plus lock removal, then launches the per-user signed NSIS installer and restarts the application. Launch failure attempts to resume the old host. A remote branch host is never shut down for a client-only update. The chosen HDMI monitor and enabled state are restored when the manager restarts or the screen returns, provided the saved branch connection matches and the monitor is a secondary display. Encrypted pairing, host setup, audio/printer preferences and the last manager tab persist across restarts. Missing LAN/HDMI does not reset setup.

### Private GitHub delivery

Source and Windows releases live in the private repository dataswarmproject/alnatheer-queue. Windows packages use a pinned Ed25519 release signature and SHA-256 installer digest. A Windows code-signing certificate is optional for this delivery path; Ed25519 verifies the publisher within the application, but does not remove Windows' unknown-publisher warning for the first installation.

SARAF headquarters brokers the private assets. Deploy the queue updates route and set QUEUE_UPDATE_GITHUB_TOKEN on the server only, using a fine-grained GitHub token with Contents:read for the queue repository. Registered active branches authenticate using their existing HQ sync key. The branch proxies metadata and streams the installer to its manager. GitHub credentials never reach branch devices. The manager independently checks the pinned release signature, exact size and digest before download acceptance, before maintenance and again before launch. A damaged download can be downloaded again.

The footer badge is inactive when there is no newer release. Development builds do not offer installation. Packaged Windows managers check the saved HQ connection; an unavailable source is reported accurately rather than treated as an empty release list. Download, install, Saudi-time scheduling, cancel scheduling and ignore-this-version remain available for verified newer releases. Live HQ delivery still requires server deployment and the read-only repository credential. Each teller/kiosk PC receives the same installer separately; manager installation is not a fleet rollout.

The private release signing key stays outside Git. Keep a secure backup: a different key cannot replace the committed trust root. prepare-release-signing.cjs verifies an existing signer and refuses missing or mismatched keys. Initial bootstrap is allowed only with no existing trust root. CI stores the key as an encrypted GitHub secret; released clients include only its public key.

On a Windows release machine, provide QUEUE_FONT_ARCHIVE pointing to the owner-supplied Thmanyah archive and QUEUE_VOICE_LIBRARY_DIRECTORY pointing to the verified free offline Arabic bundle. Raw font files are excluded from Git. The hosted release pipeline restores owner-authorized encrypted font build inputs and the voice bundle from a private build-input release, then verifies and embeds them. It signs the manifest and publishes only the installer, signature manifest and checksums as a stable release.

## Local evidence boundary

Branch tests and native Electron tests use disposable test records/databases and exercise configuration, role checks, counter history, backups/restore, sync recovery, update states, report exports, Arabic fonts, dual dates, HDMI window isolation and responsive TV layout. Physical LAN certificate distribution, HDMI/audio hardware, thermal printing and a signed updater upgrade are separate deployment qualifications. Licensing/subscription enforcement has not been implemented.
