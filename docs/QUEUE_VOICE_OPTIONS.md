# Arabic voice selection — 2026-10-13

The user selected the generated **A with a stronger pause** sample. The source announcement template and offline preparation plan now match that exact text:

> على صاحب التذكرة رقم A... ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.

This is a pronunciation correction after the 0.3.4 installer. Other service prefixes keep their existing pronunciation; counter phrases are unchanged. Existing saved counter recordings remain reusable. A-023 to counter 3 also has a complete, user-auditioned recording, reusable from the same content-addressed cache.

## MAI-Voice assessment

[Microsoft's MAI-Voice-2 page](https://microsoft.ai/models/mai-voice-2/) lists supported languages without Arabic. [Current MAI-Voice-2.1 and Flash documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices) likewise has no Arabic entry in its managed voice table. These are documented supported-language checks, not a claim that an experimental Arabic request can never produce speech. The full Arabic queue library should not depend on unverified pronunciation.

[Azure Speech's voice table](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts) explicitly lists Saudi Arabic voices `ar-SA-HamedNeural` and `ar-SA-ZariyahNeural`. They are candidates for an audition if using Microsoft's service; neither has been integrated or tested in this project yet.

The user requested a **free** solution after that provider comparison. The selected free path is [Chatterbox Multilingual V3](https://github.com/resemble-ai/chatterbox), using its built-in voice, pinned MIT-licensed model files and a separate local generation environment. The recording cache uses its own voice/model identity; it never mixes in the previous paid-provider recordings.

The free model is cache-only in the branch service. Even if an old API key remains configured, a missing local recording cannot fall back to a paid provider. A complete local profile automatically takes precedence over remote voice settings. Invalid voice metadata disables speech without preventing ticket service startup. The desktop imports a complete, checksum-verified bundled cache during host setup and omits API-key entry when that library is available.

The earlier provider attempt remains separate: six counter recordings and three auditions were saved, and failed requests were not retried. Those recordings are not the free library. No operational database is opened by the local generation worker.
