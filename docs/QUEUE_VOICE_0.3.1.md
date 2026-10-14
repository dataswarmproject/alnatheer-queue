# Arabic queue announcements 0.3.1

The supplied voice note specifies a ticket code followed by the destination counter. The screen now speaks `تذكرة رقم إيه 23، الرجاء التوجه إلى الكاونتر رقم 36.` for `A-023` at `كاونتر 36`. Ticket letters are retained and spelled for the Arabic voice. Numeric padding is removed only for speech; stored, printed and displayed ticket codes stay intact. Numbered counters recognize Arabic, Persian and ASCII numerals; named counters retain their real name rather than inventing a number.

Only installed local Arabic speech voices are eligible. The Saudi locale is preferred, and the screen refreshes its list on `voiceschanged`. Missing voices show a setup requirement; speech-engine errors stop playback and show recovery guidance. Calls are serialized, recall events repeat the phrase, duplicate refreshes do not repeat speech, mute clears pending playback, and old or inactive queued calls are skipped. The test button explicitly introduces an audio test without issuing a ticket; enable live announcements after testing.

## Verification

- All 33 branch/unit/synchronization tests passed, including four Arabic-wording cases and Saudi midnight behavior.
- Queue desktop/branch/core type checks and the Windows 0.3.1 package build passed.
- The native HDMI workflow passed with a simulated speech engine and real branch commands: voice availability updates, exclusion of English/remote voices, Saudi selection, the test phrase, next-ticket announcement, repeat on recall, no repeat on polling, and mute behavior.
- Five native devices passed their existing operational, printer retry, analytics, backup and offline synchronization workflow. The bundled packaged server passed provisioning, authenticated HTTP, backup and restore checks.
- The first native voice enumeration was temporarily empty. A later native run exposed one local Arabic voice, and Windows SAPI confirmed enabled `Microsoft Naayf` (`ar-SA`). A local WAV sample was generated with that installed voice under `apps/queue-desktop/test-results/arabic-announcement-a23-counter36.wav`.

The generated WAV is a preview, not a recording from the branch TV. Physical HDMI audio routing, volume and intelligibility remain a branch check. This build does not install language packs or change sound output. See the [Windows voice installation instructions](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices) if the target manager/display PC lacks a local Arabic voice. No production deployment or operational data changes were performed.
