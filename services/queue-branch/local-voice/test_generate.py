"""Regression tests for interruption recovery; no model or operational database."""

import contextlib
import hashlib
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

from generate import cache_key, main


class CompletionRecovery(unittest.TestCase):
    def test_recovers_profile_after_last_audio_saved_before_completion(self):
        with tempfile.TemporaryDirectory(
            prefix="queue-local-generation-test-"
        ) as directory:
            root = pathlib.Path(directory)
            cache = root / "speech-cache"
            cache.mkdir()
            voice = "alnatheer-arabic-local-test"
            model = "chatterbox_multilingual_v3"
            text = "TEST ONLY"
            key = cache_key(voice, model, text)
            item = {
                "key": key,
                "file": f"speech-cache/{key}.mp3",
                "text": text,
                "code": "AUDIO TEST",
            }
            audio = b"ID3" + b"\0" * 100
            (root / item["file"]).write_bytes(audio)
            manifest = {
                "voiceId": voice,
                "model": model,
                "engine": {"builtInVoice": True},
                "entries": [item],
                "samples": [],
                "totalClips": 1,
            }
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            report = {
                "voiceId": voice,
                "complete": False,
                "recordings": {
                    item["file"]: {"sha256": hashlib.sha256(audio).hexdigest()}
                },
            }
            (root / "generation-report.json").write_text(
                json.dumps(report), encoding="utf-8"
            )
            argv = [
                "generate.py",
                "--manifest",
                str(root / "manifest.json"),
                "--models",
                str(root / "not-loaded"),
                "--output",
                str(root),
                "--max-new-clips",
                "1",
            ]
            with (
                patch.object(sys, "argv", argv),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                main()
            self.assertTrue(
                json.loads((cache / "voice-library.json").read_text())["complete"]
            )
            self.assertTrue(
                json.loads((root / "generation-report.json").read_text())["complete"]
            )
            # A tampered cached clip must fail without publishing a new profile.
            (root / item["file"]).write_bytes(b"CHANGED")
            with (
                patch.object(sys, "argv", argv),
                self.assertRaisesRegex(ValueError, "unverified"),
            ):
                main()


if __name__ == "__main__":
    unittest.main()
