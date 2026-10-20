# Queue 0.4.6 — automatic branch TLS

The default network setup now creates a free, offline, per-branch certificate authority and an IP SAN server certificate. An existing localhost-only host follows the qualified maintenance/backup/drain/restart path without changing its database or UUID. Fresh network setup uses the same certificate provisioner. Corporate TLS remains an explicit manual option.

## Trust boundaries

- A pairing file is a sensitive, out-of-band provisioning artifact issued by an authenticated manager. It contains one device token and the branch public CA, SHA-256 fingerprint and UUID. It contains no CA private key, leaf private key or passphrase.
- Certificate validation uses Node/OpenSSL chain, validity and hostname/IP checks. The imported CA replaces trust for that branch request only; it is not added to Windows, global Node trust, SARAF, the update feed or internet services. Redirects and HTTP with private branch trust are rejected.
- Connection setup verifies the snapshot branch UUID and requested role before saving encrypted credentials. Failed imports retain the previous connection. HDMI companion credentials inherit the manager's public branch trust, while retaining display-only authorization.
- The CA private key is encrypted with Electron safeStorage for the Windows account. Leaf keys are encrypted PKCS#8; their random passphrase is stored in the encrypted host settings and supplied only to the owned host process. No secrets are logged or included in release artifacts.
- Certificate issuance accepts only a validated branch UUID and the locally selected IPv4 address. Existing database folders remain protected. CA identity is retained across repeated attempts and leaf renewal; a corrupt/missing authority cannot silently rotate an existing configured trust identity during renewal.
- Renewal occurs before expiry when starting a stopped service. It does not replace a running database owner. A fixed IP/reserved DHCP address and IT-approved LAN/VPN firewall/routing remain necessary. No firewall or Windows trust changes are made automatically.

## Evidence and boundaries

- Queue core, service and desktop type checks pass. All 34 service test files / 105 tests pass; production dependency audit reports no known vulnerabilities. Frozen lockfile installation succeeds.
- Real TLS tests reject another branch root, an incorrect IP/hostname, an expired server certificate and HTTP, and verify no request credentials reach the HTTP handler after failed TLS verification. Renewed leaf certificates retain the authority fingerprint. Public trust fingerprint tampering is rejected.
- Native automatic network tests cover the existing-host transition, recovery after a denied atomic settings replacement, verified backup, preserved database identity, encrypted local authority state, public-only pairing export, actual teller import, HDMI companion access and manager restart persistence without OS trust changes.
- Native first-run LAN setup is checked separately. Both Electron 44 and Electron 22 builds use the same TLS and pairing code. Packaged service/runtime and installer signature checks remain release gates.

Native qualification runs on Windows 11, including the real Electron 22 runtime. This does not establish physical Windows 7, thermal-printer or HDMI hardware acceptance. The Windows 7 SP1 x64 build remains a legacy target requiring branch IT validation. The new pairing format requires 0.4.6 clients; update teller/kiosk/manager applications before importing automatic-certificate pairing files. Existing manual TLS and loopback configurations remain supported.

Public browsers will not automatically trust this private branch CA. Use the paired desktop app. CA material is deliberately excluded from ordinary database backups; moving the host to another Windows account/computer requires explicit connection reprovisioning and re-pairing, without changing the restored database UUID.
