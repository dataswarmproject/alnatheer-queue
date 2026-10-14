# Printed queue ticket 0.2.1

The native ticket printer now uses a compact thermal layout derived from the supplied Alnatheer paper ticket: the existing company logo rendered in monochrome, Arabic company identity, a prominent unchanged queue number, one Arabic service name, an optional configured English service name, concise waiting instructions, and the actual server-issued Gregorian date/time in Riyadh. Bundled Geist and Arabic fonts load locally without network access. Text and service labels are escaped before HTML rendering.

The manager can configure an optional English service name. That value survives local configuration/snapshot/outbox serialization. The app captures service labels for the issued receipt rather than generating a translation. Existing Arabic-only service configurations remain valid. SARAF headquarters, the branch host and device applications should use matching updated contracts before enabling the additional metadata; older strict clients/receivers cannot read unfamiliar fields.

Printing supports 58mm and 80mm paper. After fonts and images load, the native process measures the ticket and requests its content height plus a small trailing margin; it no longer requests a fixed 140mm sheet. Long labels wrap, and long ticket numbers shrink to fit the printable width. The original ticket stays available after a driver failure, allowing a print retry without issuing another ticket. The UI and native application keep the supplied pink logo; monochrome conversion applies only to the thermal receipt.

## Verification

- All queue core/branch/desktop/SARAF type checks passed.
- All 26 branch/database/synchronization tests passed with optional English metadata assertions.
- Four native print-document cases passed: normal and long-content receipts at both widths, with fonts loaded, no horizontal clipping and one PDF page each.
- Normal proof receipts measured approximately 58 × 104mm and 80 × 111mm; long-content receipts measured approximately 58 × 117mm and 80 × 115mm. Actual length follows the configured service text.
- Service strings containing HTML/script markup render as text, without injected elements.
- Five-device native workflow passed, including printer failure/retry, grayscale/silent 58mm options, retained ticket identity, new paper length, TV updates, manager analytics and backup, WAN outage recovery, and connection isolation.
- Windows installer 0.2.1 was rebuilt; no production migration or operational ticket data was inserted for previews.

`pnpm --filter @saraf/queue-desktop test:tickets` regenerates the test-only sample receipt documents and exports native PDFs/screenshots. Final proof PDFs/previews are under `output/pdf`; sample A-023 is design content only and is never seeded into a branch database. Hardware printer, paper feeds and cutter margins still require a physical branch test; the automatic tests simulate the driver and generate native PDF proof.
