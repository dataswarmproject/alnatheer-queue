# Queue setup and manager HDMI display 0.3.0

First launch now offers teller, ticket kiosk, branch management, manager-connected HDMI TV and branch-server setup. Existing paired devices retain their configuration. A selected role must match the server-authenticated key before credentials are saved. Manager-issued pairing files can be exported privately and imported on the assigned device without typing the key.

New-host setup validates an empty physical local folder and available port, provisions the initial manager and persistent database through the bundled runtime, stores host credentials/configuration with OS encryption, and starts a separate background process. It can resume a saved setup without recreating data. Installed Windows builds offer startup at account sign-in; a service-account task is still needed for operation before sign-in. LAN TLS trust/firewall and headquarters authorization remain explicit deployment configuration.

The manager opens a separate full-screen room view on a selected second display. The television is connected through HDMI using Windows Extend mode. Its ephemeral display key and read-only IPC prevent staff commands or setup operations from the customer screen. Closing/unplugging the TV closes that view; revocation is attempted when the branch is reachable. Delayed provisioning cannot reopen a canceled TV. The manager GUI and independently running database host have separate lifetimes.

## Verified locally

- Queue core, branch and desktop type checks passed.
- All 29 real database/branch/synchronization tests passed, including midnight rollover.
- Native setup tests created an empty persistent database, preserved an occupied folder, encrypted saved configuration, removed the temporary plaintext initial key, and verified server survival after manager exit and reuse after restart.
- Native HDMI tests checked monitor selection, primary-screen protection, separate full-screen/display and manager windows, real ticket updates, forbidden TV mutations/one-way pointer messages, key revocation and canceled-opening recovery. Monitor inventory was emulated; physical HDMI routing/audio was not verified.
- Manager pairing-file export and kiosk import passed through the native dialogs and actual branch authorization.
- Existing native teller/dock tests passed at four widths; the five-device workflow passed including printing failure/retry, TV/counter TV updates, manager analytics/backup and WAN outage recovery.
- The Windows installer was rebuilt as 0.3.0. Its bundled runtime passed private provisioning, authenticated HTTP, backup and restore tests into a separate directory.

No production deployment, migration, real operational seed data or real-account Windows startup registration was performed. Printer and HDMI hardware verification, certificate trust/firewall deployment and installer signing remain branch rollout work. Queue dependency audit reports no high/critical queue findings and one existing moderate build-tool finding; the unrelated SARAF workspace has its own unresolved findings.
