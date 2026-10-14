# Arabic queue audio: implementation decision

Research checked on 13 October 2026. This compares documented capabilities; no claim that untested models match a Saudi voice artist's pronunciation.

| Approach                                             | Strength                                                                        | Practical limit                                                                               | Status in SARAF Queue                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Full prerecorded sentences                           | No splice between ticket and destination; deterministic playback                | 9,990 recordings for A1–A999 across ten counters; additional service prefixes multiply volume | Supported, takes priority over composition                                          |
| Complete ticket phrase + complete destination phrase | 999 + 10 recordings cover 9,990 combinations; no individual-digit chopping      | Must audition consistent voice, pacing and boundary pauses                                    | Implemented with decoded buffers and a scheduled 120 ms pause                       |
| Saudi voice artist recordings                        | Direct editorial control of dialect, pronunciation and consistency              | Requires recording/editing and rights from the artist                                         | Compatible with the prepared audio library; recording/import workflow not built yet |
| ElevenLabs neural Arabic                             | Selected native Arabic voice, context parameters and complete-phrase generation | Working API account, private key, voice ID and suitable commercial plan needed                | Implemented on branch host with cache and generation budget                         |
| Azure neural speech + SSML                           | Explicit voice, pace, pronunciation and pause controls; batch synthesis         | Azure resource/account and audition required                                                  | Researched alternative; provider adapter not implemented                            |
| Chatterbox Multilingual                              | Arabic support; local model execution; MIT repository/model licensing           | Benchmark actual hardware and Saudi pronunciation before choosing                             | Researched alternative; local inference service not installed                       |
| Piper Arabic                                         | Local engine, Jordanian Arabic voice available                                  | Voice model card directs licensing to its dataset; Saudi quality is unverified                | Evaluated, not selected as the primary quality upgrade                              |

## Chosen architecture

Prepare **999 complete ticket phrases and 10 complete counter instructions** for each required service prefix. Counter instructions can be shared across prefixes. Include one separately labeled audio test: A23 → counter 36. This yields **1,010 recordings for one prefix**, or `999 × prefixes + 10 + 1` for multiple prefixes. The player uses a complete sentence if cached; otherwise it schedules the two matching whole phrases locally. It never constructs Arabic numbers by splicing digit recordings.

Keep all assets on each branch host. Cache keys incorporate voice, model, text and synthesis profile version. Midday recalls and Saudi midnight numbering resets reuse the same recordings. New numbers outside the prepared range or renamed counters need new audio, or live generation when configured. No inference hardware is needed during prepared playback.

For neural phrase preparation, use a consistent voice/model/settings and contextual preceding/following text where supported. Request-ID stitching is a generation-time tool, not a permanent offline playback requirement: ElevenLabs documents a two-hour request-ID window and excludes `eleven_v3` from stitching. The implementation uses text context for phrase segments on other models and does not chain ticket 1's request to ticket 2 as if it were one continuous story.

Before generating the complete library, audition a small set covering 1, 2, 11, 12, 23, 36, 99, 100, 101, 200 and 999, and all ten counter instructions. Check each ticket/counter aloud, then verify volume and intelligibility through the actual branch HDMI speakers. A transcript alone cannot certify voice quality. The supplied MP3 is a reference recording, not permission to clone its speaker.

## Primary sources

- [ElevenLabs create-speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): model/voice parameters, output formats, preceding/following text.
- [ElevenLabs request stitching](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/request-stitching): prosody context, unsupported v3, request-ID time limit.
- [ElevenLabs billing](https://elevenlabs.io/docs/overview/administration/billing): paid-plan commercial rights; free output is noncommercial with attribution. Use appropriately licensed recordings for the firm.
- [Microsoft SSML overview](https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/speech-synthesis-markup): pronunciation, pace and pause controls.
- [Microsoft batch synthesis](https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/long-audio-api): batch inputs and individual audio output.
- [Chatterbox official repository](https://github.com/resemble-ai/chatterbox): Arabic in the multilingual model; local CPU/CUDA examples and MIT license. Its Turbo/Nano English models are not substitutes for Arabic Multilingual.
- [Chatterbox model repository](https://huggingface.co/ResembleAI/chatterbox/tree/main): model licensing.
- [Piper voice documentation](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md) and [Arabic Kareem model card](https://huggingface.co/rhasspy/piper-voices/blob/main/ar/ar_JO/kareem/medium/MODEL_CARD): ar_JO support and model-specific licensing checks.

## Remaining evidence

No 1,010-clip production library has been generated yet. The connected sample service rejected generation because free-tier access was disabled. The repository has no configured speech API key. A working private key and the exact approved Arabic voice ID are needed for neural generation; choosing a paid plan or a voice artist is the user's decision. Code tests, a dry run and fixture audio playback verify the workflow separately from the still-required pronunciation audition.
