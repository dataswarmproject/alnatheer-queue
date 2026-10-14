# Free offline Arabic announcements — 0.3.5

Arabic queue announcements now use a completed local recording library with no speech subscription or API key. The Windows installer bundles the recordings and the host wizard installs them automatically. The GPU model is used only during preparation; it is not installed on branch PCs.

## Coverage and wording

- A1–A999: 999 ticket phrases with the selected `A...` pause.
- Counters 1–10: ten destination instructions.
- One fixed audio test: 1,010 required cache recordings in total.
- Four full-sentence samples and four examples composed from the exact playback segments.
- Every ticket can combine with every counter: 9,990 calls. Other service prefixes or counter numbers need additional recordings.

Example: `على صاحب التذكرة رقم A... ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.`

The phrase segments join with a 120 ms gap. Existing alert → white/pink call panel → voice → five-second hold → black panel timing is retained.

## Verification completed locally on 2026-10-14

- 1,014 required recordings/samples decoded, with receipt checks, mono 24 kHz audio, valid signal and duration; longest recording 8.72 seconds.
- All 9,990 combinations covered, forty cache-playback checks passed and missing-prefix rejection made zero provider requests.
- 65 branch tests, all three queue typechecks, desktop build and generation interruption-recovery test passed.
- Native generated-audio playback passed: authenticated branch API → IPC → actual MP3 decoding/end events, segment scheduling, alert/highlight timing, offline recall and mute.
- Complete-bundle test blocked a simulated paid host before speech POST, detected activation without remounting the display, then played the real library. A separate paid-configured legacy fixture was rejected before any speech POST.
- Host wizard copied all 1,010 files, hid speech-key fields, preserved an occupied folder and resumed its persistent database.
- Windows installer built. Packaged runtime auto-loaded its free profile, served authenticated cached audio without a key, created a real backup and restored it into a new directory while retaining the original database.
- Five-device and HDMI workflows passed. Monitor inventory/Windows fallback speech were emulated; physical HDMI speaker output and human pronunciation review are not certified by these checks.

## Installation and activation

Use `Alnatheer Queue Setup 0.3.5.exe` for the branch host and client roles. This evaluation installer is unsigned. New hosts load the free profile automatically. Updating the manager UI does not stop its independently running old host: restart the branch host during maintenance after updating to load the new profile. Its database and pairing configuration are retained.

Updated clients with a free bundle refuse new paid speech requests and show a restart notice when the connected service still allows remote synthesis. Older clients remain outside this guard until upgraded; the host restart is required to make the whole branch use the new profile. The TV rechecks activation every five seconds while restart is required.

Voice installation writes only the speech cache, publishes files atomically and preserves damaged library-owned recordings for inspection. It does not restore, replace or delete operational database files.

The separate `Alnatheer Arabic Voice Library 0.3.5.zip` contains the MP3s, activation profile, manifest, generation receipts, decoder validation, listening page and attribution. It excludes model weights, Python, logs and the older paid samples. SHA-256 sidecars accompany the installer and ZIP. Audition the combined samples before branch rollout.

See [recording preparation](../services/queue-branch/local-voice/README.md) and [source/model attribution](../services/queue-branch/local-voice/VOICE-LICENSES.md).
