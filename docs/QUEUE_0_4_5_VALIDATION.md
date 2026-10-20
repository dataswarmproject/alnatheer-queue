# Queue 0.4.5 release qualification

This release fixes the branch-device connection failure caused by exporting `127.0.0.1` from a server configured for this computer only. The manager on that computer can now enable LAN/VPN HTTPS under **إدارة النظام → إعداد اتصال الشبكة** without recreating the database. It verifies the proposed TLS endpoint before maintenance, requires closed tickets, creates and verifies a backup, drains the owned host, saves settings atomically, and restarts the same database and identity. Failed settings writes recover the prior host; a candidate that cannot be drained is never force-killed or replaced by a second database owner.

Pairing accepts UTF-8 BOM files and surrounding clipboard whitespace. Branch-reference JSON files have a specific rejection message. Network, loopback, certificate and protocol failures have separate operator messages. No token, password, database or private certificate is included in source or the IT handoff.

## Completed local checks

- Type checks across queue core, branch service and desktop app.
- 33 branch test files, 104 tests passing, including real persistent PostgreSQL WASM, backup/restore, queue commands, synchronization and the new pairing/network error cases.
- No known production dependency vulnerabilities reported by `pnpm audit --prod --audit-level=high`.
- Actual Electron 22 native first-run setup, UUID persistence/export and existing-folder protection; manager counters; five-device kiosk/teller/room-display/counter-display/manager flow, including printed-ticket eligibility, headquarters outage and catch-up; manager database/backup/restore/reports; emulated HDMI management.
- Existing-host LAN transition on both Electron 44 and Electron 22: reject an incorrect HTTPS endpoint before changing settings; recover the original database/configuration after a real denied file replacement; enable trusted HTTPS on a real local network interface; export and import a teller pairing file; retain database identity and the network connection across manager restart. Test-only CAs stay in process configuration; no OS trust or firewall changes are performed by this test.
- Both packaged runtime qualifications passed: independent empty operational database, authenticated local audio cache, verified backup and restore into another directory. The spoken-announcement feature remains disabled.
- Both application/installer publisher signatures and timestamps validate against the existing Digital Trendz internal certificate. The release manifests are signed with the existing pinned Ed25519 identity. Packaged main bundles match the qualified source builds byte for byte.

## Release boundaries

The Windows 7 package targets Windows 7 SP1 **x64 only**, with Electron 22.3.27 / Chromium 108 / Node 16 and an explicit Node 16 runtime bootstrap and packaged ESM descriptor. Electron 22 is an unsupported legacy runtime. The Windows 10/11 package retains Electron 44.7.0. Legacy automatic updates are disabled so it cannot receive a modern installer; its signed verification manifest is separate from the modern update manifest.

All native qualification above ran on Windows 11. It is not evidence of execution on physical Windows 7 hardware. Branch IT must validate an actual Windows 7 device, approved certificate trust, LAN/VPN routes and firewall, thermal-printer driver and paper/cutter, and the physical HDMI display before branch rollout. Database contents and operator setup persist across reinstall by design.
