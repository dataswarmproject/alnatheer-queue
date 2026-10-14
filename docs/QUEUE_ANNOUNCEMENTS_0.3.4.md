# Ticket and counter announcements — 0.3.4

Approved wording:

> على صاحب التذكرة رقم ٢٣ التوجه إلى الكاونتر رقم ٣

For a printed A-023 ticket, the actual speech text is:

> على صاحب التذكرة رقم إيه، ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.

The service letter remains audible because each service can have the same number. Numeric-only codes omit the letter. Arabic/Persian digits and leading zeros are normalized; numbers are spoken as words. Named counters keep their configured name.

The same template drives natural speech, local Windows speech and offline recording preparation. The fixed audio test is A-023 to counter 3 across all three paths. A recall repeats the same code and destination; a transferred ticket keeps its printed code and announces its new counter when called there. Old calls for the original counter are rejected.

The alert and visual sequence from 0.3.3 is preserved: bundled alert, white/pink panel, voice, five-second hold, fade to black. Split playback uses two complete phrase recordings with a 120 ms pause, not individual digit recordings. Ticket clips end at the comma; counter clips continue the same sentence. Provider context never supplies an unrelated ticket number.

## Offline library

The included `voice-plan-10x999.json` covers A-001 through A-999 and counters 1 through 10: 999 ticket phrases + 10 destination phrases + 1 fixed test = **1010 recordings**, covering **9990 calls**. The updated wording totals **45268 characters** in the dry run. This count is a planning measure, not a price estimate.

See [voice preparation instructions](QUEUE_VOICE_0.3.2.md) for private voice configuration and the bounded preparation command. The wording change creates new content-based audio cache keys. Old recordings remain intact but are not reused for the new sentence; prepare the new library before upgrading a cached-only branch. This release does not automatically generate paid audio or migrate operational databases.

## Verification

Focused tests cover exact approved wording, number boundaries, all 9990 composed combinations, provider context, cached recalls, transfers to another counter and rejection of stale speech. Native HDMI and natural-audio tests verify local voice text and playback order. Natural synthesis uses a test fixture; real pronunciation and speaker clarity still require an approved Arabic voice and an on-site audition.

Windows installer: `Alnatheer Queue Setup 0.3.4.exe`.
