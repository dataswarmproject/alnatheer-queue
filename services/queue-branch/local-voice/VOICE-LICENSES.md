# Local Arabic announcement recordings

These MP3 files were generated locally for Alnatheer queue announcements using the built-in Chatterbox Multilingual V3 voice. No user recording was cloned and no paid speech service was called. The engine's Perth audio watermark is retained.

- Source: https://github.com/resemble-ai/chatterbox at `5de7a54aa4e5e2baadb0182dde554908b48b85c2` (MIT).
- Model: https://huggingface.co/ResembleAI/chatterbox at `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18` (model card: MIT).
- Copyright notice: Copyright (c) 2025 Resemble AI. The source license is included as `CHATTERBOX-LICENSE.txt`.
- Runtime dependencies are listed in `requirements-installed.txt` for reproduction; Python, PyTorch, model weights and the FFmpeg encoder are not included in the desktop voice bundle.

The installed branch server only reads the MP3 cache. It does not run the generation model or require a speech subscription, API key, Internet connection or GPU. Coverage is A1–A999 and counters 1–10; each ticket phrase combines with each counter instruction. Other service prefixes or counter numbers require preparing additional recordings.

`manifest.json` records the exact spoken text and model settings; `generation-report.json` records duration, seed, generation time, file size and SHA-256 receipts. Human audition is still needed to judge pronunciation and clarity in the actual waiting room.
