# Natural Arabic queue announcements — 0.3.2

The TV can use full-sentence neural recordings or two prepared whole-phrase recordings instead of Windows speech. Ticket prefixes stay audible, digits become Arabic words, and a pause separates the ticket from its destination:

> التذكرة رقم إيه، ثلاثة وعشرين. يُرجى التوجّه إلى الكاونتر رقم ستة وثلاثين.

The supplied MP3 was transcribed as A23 → counter 36. An MP3 does **not** contain a usable provider voice ID or grant permission to clone its speaker. To reproduce the selected voice, obtain that voice ID from the account that generated the recording.

## Setup

New branch host: open **خادم الفرع → النداء بصوت عربي طبيعي**, enter the Arabic voice ID and the private service key. The wizard saves the key with Windows credential encryption and supplies it only to the branch process. On the TV select **صوت طبيعي**, test HDMI sound, then enable announcements. Testing temporarily mutes live announcements; enable them after the test ends.

Existing manually managed branch host: set these in its private environment and restart only that branch process:

```dotenv
QUEUE_SPEECH_VOICE_ID=YOUR_SELECTED_ARABIC_VOICE_ID
QUEUE_SPEECH_API_KEY=YOUR_PRIVATE_SERVICE_KEY
QUEUE_SPEECH_MODEL=eleven_multilingual_v2
QUEUE_SPEECH_CACHE_DIR=D:/AlnatheerQueue/speech-cache
QUEUE_SPEECH_DAILY_LIMIT=500
```

For an existing wizard-managed host, these optional values must be included in its saved encrypted host settings. This release exposes the fields during **new-host setup**; it does not yet include an editor for an existing saved host. Do not recreate an existing host/database to change its voice. IT can instead run the existing branch data directory with the manual launcher/private environment.

Voice credentials stay on the branch host. The renderer receives only approved audio; it never receives the provider key. Only ticket wording and counter labels are submitted, without customer identities, transactions or staff records. The default API model is `eleven_multilingual_v2`; the sample-generation connector's `eleven_v4` identifier is not assumed to be an available production API model.

## Scenarios

| Event                                 | Announcement behavior                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| New ticket called                     | Generate the complete ticket/destination sentence, save it, then play it.                                                                |
| Recall                                | Reuse the same recording; no new synthesis for a cache hit.                                                                              |
| Different service prefix              | Say the prefix, preserving A23 versus B23.                                                                                               |
| Transfer                              | Do not play audio for the old destination after transfer. On the next call use the new counter.                                          |
| Completed ticket, old call or refresh | Skip inactive/older calls; refresh does not replay history.                                                                              |
| Saudi midnight number reset           | Reuse date-independent recordings; ticket/event history remains unchanged.                                                               |
| Provider/network outage               | Cached phrases continue; a new uncached phrase reports failure and requires a connection. There is no automatic switch to another voice. |
| Voice/model/wording change            | Use a distinct cache key; old recordings cannot be mistaken for the new profile.                                                         |
| Mute                                  | Stop playback and discard pending announcements.                                                                                         |

`صوت الجهاز` remains an explicit alternative. The app does not present this as equivalent to neural quality.

## Prepare an offline library

The recommended ready-made plan is [voice-plan-10x999.json](../services/queue-branch/voice-plan-10x999.json): **999 ticket phrases + 10 destination phrases + 1 audio test = 1,010 clips**, covering all **9,990 ticket/counter combinations** for prefix A. Its dry run reports **36,340 spoken-text characters** before provider pricing. Additional prefixes require another 999 ticket phrases each; destination recordings are shared. Change the plan's actual prefixes and counter names to match the branch.

```powershell
pnpm prepare:speech --plan voice-plan-10x999.json
# After audition, configure a working private key, stop the branch host,
# and deliberately set QUEUE_SPEECH_DAILY_LIMIT to 1010 or prepare over several days.
pnpm prepare:speech --plan voice-plan-10x999.json --execute --max-new-clips 1010
```

`"mode":"split"` prepares whole ticket phrases and whole destination instructions. Both are decoded before playback and scheduled with a 120 ms sentence pause and short gain ramps at segment boundaries. The player uses a full recording whenever present, then cached phrase composition, then live whole-sentence generation if configured. The library is shared by live calls and recalls and remains usable after the provider is disconnected. Consistent voice/model and a human audition of joins are still necessary.

`"mode":"full"` prepares the full matrix instead:

For A1–A1000 and six counters, there are **6,000 ticket/counter combinations**, plus the audio-test recording. Extra prefixes multiply the combinations. Prepare the branch's expected range and actual counter names; the tool deduplicates equivalent sentences. A plan is limited to 10,000 combinations. Daily generation allowance defaults to 500 attempts and resets at Saudi midnight; increase it deliberately for an approved preparation batch.

Example `voice-plan.json` for full recordings (start with a small audition batch):

```json
{
  "mode": "full",
  "prefixes": ["A"],
  "counters": ["كاونتر 1", "كاونتر 2", "كاونتر 3"],
  "start": 1,
  "end": 10
}
```

From `services/queue-branch`, with private `.env` configured:

```powershell
pnpm prepare:speech --plan voice-plan.json
```

This dry run prints the unique combinations, missing recordings and exact text-character count. It performs no synthesis. Review those counts against account pricing and audition the chosen voice before approving a large batch. Then, **stop the branch host** so its cache has one writer, and run:

```powershell
pnpm prepare:speech --plan voice-plan.json --execute --max-new-clips 31
```

The first example has 30 calls plus one test phrase. The execution limit is required. Generation stops on an error; rerunning reuses completed recordings. The tool never opens or modifies the operational database. Use the same voice/model/cache folder in the host afterward. With the API key absent but the voice ID configured, the TV uses cached-only mode. Keep the cache on the branch LAN host, outside its database directory, and back it up separately. No GPU is required to play prepared recordings.

Installed Windows runtime: configure the same private process environment, then run `resources/branch/queue-prepare-speech.cmd` with the same arguments. Keep its paths quoted.

## Bounds and evidence

- At most 16 distinct pending synthesis requests, one synthesis at a time, 12-second provider timeout, 2 MiB per MP3 and 512 MiB total cache. A full cache requires IT action; no automatic deletion of prepared audio.
- Daily attempt reservations persist before network submission. An uncertain or failed paid request is not automatically retried. Provider errors trigger a one-minute cooldown. Cache hits bypass the provider and budget.
- Strict device authentication and counter scope; clients submit an existing announcement sequence or the fixed audio test, never arbitrary text. Server and client reject stale/inactive calls after generation. Voice generation does not participate in ticket transactions.
- Tests cover numeral boundaries, plan volume limits, cache persistence, deduplication, usage budget, provider errors, authorization, recall and completion during generation.
- Native Electron tests decoded and played the supplied MP3 through both full-recording playback and scheduled two-segment playback, exercised real branch calls, cached recall during a simulated provider outage and mute. Their provider is a test fixture; these verify audio transport/player/timing, not generated pronunciation for every number.
- Live synthesis is **not yet verified**: the connected service rejected the new preview because free-tier access was disabled. A working API account/key, the exact selected Arabic voice ID, and an actual HDMI/speaker audition remain necessary. Do not interpret builds or fixture tests as voice-quality certification.

API implementation follows the official [create-speech documentation](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
