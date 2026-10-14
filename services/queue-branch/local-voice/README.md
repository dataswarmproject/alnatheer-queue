# Free Arabic queue recording preparation

The local generator uses the built-in Chatterbox Multilingual V3 voice with Arabic enabled. It requires no speech API key and performs no speech-service HTTP requests. After the public model and Python dependencies are installed, model inference runs offline. It does not use or clone the user's reference recording.

Pinned code: `resemble-ai/chatterbox@5de7a54aa4e5e2baadb0182dde554908b48b85c2`.

Pinned MIT-licensed model: `ResembleAI/chatterbox@5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18`, checkpoint `t3_mtl23ls_v3.safetensors`. See the [official source](https://github.com/resemble-ai/chatterbox) and [model card](https://huggingface.co/ResembleAI/chatterbox).

The output contains 999 ticket phrases, 10 counter instructions, the fixed audio test, and four complete pronunciation samples. The ticket wording retains the user's selected literal `A...` pause. Output identity is `alnatheer-arabic-local-v3-5bb1f6ee-cfg0` with model `chatterbox_multilingual_v3`.

## Prepare and audition

From `services/queue-branch`, create a manifest without loading a model:

```powershell
pnpm prepare:speech:local --plan voice-plan-10x999.json --output ../../apps/queue-desktop/release/arabic-voice-library-free
```

With a separate Python environment containing the pinned upstream package, CUDA PyTorch 2.6.0, soundfile and imageio-ffmpeg, generate four full samples plus their corresponding ticket/counter phrase recordings:

```powershell
pnpm prepare:speech:local --plan voice-plan-10x999.json --output ../../apps/queue-desktop/release/arabic-voice-library-free --execute --samples-only --max-new-clips 19 --python 'D:\CodexRuntime\saraf-voice\.venv\Scripts\python.exe' --models 'D:\CodexRuntime\saraf-voice\models'
```

Then prepare the whole library:

```powershell
pnpm prepare:speech:local --plan voice-plan-10x999.json --output ../../apps/queue-desktop/release/arabic-voice-library-free --execute --max-new-clips 1014 --python 'D:\CodexRuntime\saraf-voice\.venv\Scripts\python.exe' --models 'D:\CodexRuntime\saraf-voice\models'
```

Paths above describe the isolated environment on this task's machine; use the actual Python/model paths elsewhere. GPU use is limited to preparation, not kiosk/TV/teller playback. The tool reuses recordings only when their receipts match their SHA-256 hashes. It writes a completed `speech-cache/voice-library.json` profile only after every required recording exists. Unexpectedly long, empty or invalid audio stops generation for review.

Copy the completed `speech-cache` folder into the branch server's existing `speech-cache` folder without deleting database files, then restart the branch service during an appropriate maintenance window. The new service auto-detects the completed profile and serves authenticated calls offline. The desktop installer can bundle the same folder for first-run setup. Keep the originals and their generation receipts for reproducibility.

Numerical coverage and decodable files do not substitute for human pronunciation review of the samples. This workflow produces recordings locally; generated voices do not claim to be a particular staff member or real speaker.

Verify the completed library's receipts, all 9,990 ticket/counter combinations, cache-only playback and rejected cache misses:

```powershell
pnpm verify:speech:local --library ../../apps/queue-desktop/release/arabic-voice-library-free
```

On Windows, the local preparation command sets `PYTHONUTF8=1` for Arabic logs. The tested headless Python 3.11 environment uses Torch/Torchaudio 2.6.0+cu124, Transformers 5.2.0, Hugging Face Hub 1.33.0, Tokenizers 0.22.2, NumPy 1.26.4, SciPy 1.15.3, ONNX 1.23.2 and Resemble Perth 1.0.1. Perth 1.0.1 requires `setuptools<81` because it uses `pkg_resources`; preserve its audio watermark. A full installed dependency snapshot is saved with the generated library for reproducibility.

Create four listening examples from the exact saved ticket and counter segments, with the same 120 ms join used by desktop playback:

```powershell
python local-voice/preview.py --library ../../apps/queue-desktop/release/arabic-voice-library-free
```

This also writes `pronunciation-samples.html` to audition combined recordings against the full-sentence samples. The library uses the exact source/model versions above; preserve `VOICE-LICENSES.md` and `CHATTERBOX-LICENSE.txt` when distributing it. The desktop packager verifies the entire library before bundling it, so missing files cannot silently produce an installer that needs a paid provider.

After completion, decode every MP3 and verify its receipt, channel count, sample rate, signal and duration with `python local-voice/validate.py --library ../../apps/queue-desktop/release/arabic-voice-library-free`. An interrupted installation repairs only this library's damaged recording files, preserving damaged bytes in the speech cache for inspection. Updated desktop clients block new paid speech requests when a free bundle is present; an older running host must restart during maintenance to load its profile. The TV controls and manager server panel show the required restart. The TV detects activation without needing to close the display. Older clients remain outside this new client guard until they are updated.
