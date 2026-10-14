# Free internal Windows signing for Digital Trendz

This route has no certificate purchase or signing-service subscription. The publisher certificate is self-signed, not independently validated by a public certificate authority. It is appropriate only for controlled Alnatheer branch deployment after IT approves and installs its public certificate. Windows signature validation on those devices and public SmartScreen download reputation are separate checks. Browser warnings and Smart App Control can still require managed deployment or an explicit company application-control policy. Do not disable antivirus, SmartScreen or signature checks.

The private proprietary repository does not qualify for SignPath Foundation's open-source sponsorship. SSL.com's initial free eSigner period does not make its paid certificate free. Microsoft Artifact Signing public trust currently excludes organizations registered in Algeria and Saudi Arabia. We have not opened a paid account, enrolled in a trial, or changed billing. If public Internet distribution is required later, this internal certificate will not substitute for public organization validation.

## 1. Create or reuse the free signing identity

Use one protected Windows signing account on an existing Digital Trendz PC. Obtain the private queue source and prerequisites: Node 22.19+, pnpm 10.26.2, Git, and GitHub CLI. The following paths assume the existing checkout at `E:\projects\alnatheer-queue`.

```powershell
cd E:\projects\alnatheer-queue
git pull --ff-only
powershell.exe -NoProfile -File apps\queue-desktop\scripts\create-internal-signing-certificate.ps1
```

The script creates a one-year RSA/SHA-256 code-signing certificate named Digital Trendz, country DZ, in `Cert:\CurrentUser\My`. Its private key is non-exportable and stays on this account. It exports only the public `.cer` and public signer receipt under `%LOCALAPPDATA%\AlnatheerQueue\WindowsSigning`. Re-running preserves the existing key; missing/expired keys require an explicit renewal and branch trust rollout. Keep the signing account and machine protected. Losing that account/key requires a new certificate and re-enrolling branch trust; no private-key export or automatic recovery is promised.

This certificate asserts the chosen company identity; it does not verify Digital Trendz's legal registration. No Algerian company documents or payment are needed for self-signing.

## 2. Approve trust on the signing account

Read the exported certificate fingerprint. IT must approve the exact fingerprint before installing trust. First preview the operation:

```powershell
$record = Get-Content "$env:LOCALAPPDATA\AlnatheerQueue\WindowsSigning\signer.json" -Raw | ConvertFrom-Json
powershell.exe -NoProfile -File apps\queue-desktop\scripts\trust-internal-publisher.ps1 `
  -Certificate $record.certificate -ExpectedSha256 $record.publicCertificateSha256 -WhatIf
```

Then run the same command without `-WhatIf` and accept its confirmation. The default is CurrentUser. It imports only this public code-signing certificate into Root and TrustedPublisher, checks the fingerprint, publisher, validity and code-signing-only usage, and rejects CA certificates. It does not import a private key or change Defender/SmartScreen settings. This is an explicit Windows trust change; it is not performed by the installer.

## 3. Build and verify locally without hosted CI charges

Provide the original licensed Thmanyah ZIP in `QUEUE_FONT_ARCHIVE` and the verified free Arabic voice bundle in `QUEUE_VOICE_LIBRARY_DIRECTORY` if those inputs are not already provisioned. The existing local release-signature private key must match the committed Ed25519 trust root; do not regenerate or replace it. The same signing account used in step 1 must run the build.

```powershell
cd E:\projects\alnatheer-queue
powershell.exe -NoProfile -File apps\queue-desktop\scripts\invoke-internal-release.ps1
```

Use a clean, reviewed main checkout. The script runs formatting, typechecks, real branch tests, dependency audit, native desktop workflows, Windows packaging, packaged-runtime qualification, and publisher/timestamp checks before signing the existing release manifest. It refuses missing keys, different publisher identities, invalid Windows signatures and mismatched versions. Windows app, installer and uninstaller are signed during packaging. The public certificate and a sanitized trust receipt accompany the prepared release; no absolute private signing-machine paths are published.

An internal signature is accepted for publication only after Windows validates it on the signing machine. A public timestamp authority is used by SignTool; no paid timestamp account is created. Failed timestamps/signatures stop release publication.

To publish, create and push `queue-vX.Y.Z` at the exact reviewed main commit, with all package versions matching, then run the same script with `-Publish`. It refuses overwriting an existing release and requires the dedicated private repository. The existing unsigned 0.4.1 release is unchanged. A Windows-signed and timestamped 0.4.2 installer has been built for a manual internal IT pilot. Its Windows signatures, packaged runtime, installer digest and release-manifest signature were verified. Signing-account trust is enrolled; each branch PC still needs IT-approved public-certificate trust. The IT pilot is a prerelease and does not replace the stable automatic-update release.

## 4. Optional free self-hosted automation

The `Queue internal signing (self-hosted)` workflow is manual and runs only from main in the private queue repository. It uses an existing Windows PC labeled `digital-trendz-signing`; it never selects a paid/hosted runner or runs pull-request code on the signing account. GitHub documents self-hosted runner usage as free, excluding your own machine/electricity costs. No runner is registered or background service installed by this preparation.

If desired, open GitHub repository Settings > Actions > Runners > New self-hosted runner, choose Windows x64, and follow GitHub's displayed installation commands. Add label `digital-trendz-signing`. Start `run.cmd` under the same Windows account holding the certificate. Do not run it as LocalSystem: that account cannot access the CurrentUser signing key. Use a dedicated signing account for sustained operation. Keep paid GitHub Actions budgets at zero; the previous hosted workflow has been replaced by this manual self-hosted route.

In Actions, choose the internal-signing workflow, select main, and Run workflow. By default it prepares the signed package only. Enable Publish only after the matching version tag is pushed. The workflow restores the encrypted font build inputs and verified offline voice bundle from the existing private build-input release, using the existing repository secrets. Only the release-manifest signing key is supplied through GitHub Secrets; the internal Windows signing key remains in the local certificate store.

## 5. Enroll each manager, teller and kiosk PC

Copy only `digital-trendz-internal.cer` plus the trust script to managed devices. Compare its SHA-256 with the fingerprint supplied directly by Digital Trendz, not solely a receipt downloaded alongside the file. IT can use the trust script per Windows user, or run it elevated with `-Scope LocalMachine` for all users of that managed PC. Corporate Group Policy is another deployment option.

Do not distribute signer.json from the signing account; the sanitized publisher-trust.json release receipt is sufficient. Do not copy private keys, PFX files, signing account data or GitHub signing secrets to branch PCs.

After approving trust, check both the installer and installed executable with `Get-AuthenticodeSignature -LiteralPath ...`; status must be Valid and the publisher/fingerprint must match. IT should test one PC before the branch fleet rollout. SmartScreen/Smart App Control policy may still need an explicit company deployment rule. The HDMI TV itself needs no certificate; the connected manager PC does.

The existing SARAF update broker and Ed25519 signature/digest verification remain in place. Live headquarters deployment/credentials are still required. Trust enrollment does not activate SARAF synchronization or updater delivery automatically.

## Official references

- [Microsoft self-signed certificate creation](https://learn.microsoft.com/en-us/powershell/module/pki/new-selfsignedcertificate)
- [Microsoft SmartScreen publisher and file reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [SignPath Foundation eligibility](https://signpath.org/terms.html)
- [Microsoft Artifact Signing eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [GitHub self-hosted runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
