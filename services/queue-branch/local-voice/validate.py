"""Decode and checksum every completed library recording without loading a model."""

import argparse
import hashlib
import json
import pathlib

import numpy as np
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("--library", required=True)
args = parser.parse_args()
root = pathlib.Path(args.library).resolve()
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
report = json.loads((root / "generation-report.json").read_text(encoding="utf-8"))
if report["complete"] is not True:
    raise ValueError("Library preparation is incomplete")
checked = []
for item in [*manifest["entries"], *manifest["samples"]]:
    file = (root / item["file"]).resolve()
    if root not in file.parents:
        raise ValueError("Recording path is outside the library")
    receipt = report["recordings"][item["file"]]
    if (
        file.stat().st_size != receipt["bytes"]
        or not 100 <= receipt["bytes"] <= 2097152
    ):
        raise ValueError("Recording size mismatch")
    if hashlib.sha256(file.read_bytes()).hexdigest() != receipt["sha256"]:
        raise ValueError("Recording checksum mismatch")
    audio, rate = sf.read(file, dtype="float32")
    if audio.ndim != 1 or rate != 24000 or not np.isfinite(audio).all():
        raise ValueError("Invalid decoded speech")
    duration = len(audio) / rate
    peak = float(np.max(np.abs(audio)))
    if (
        not 0.3 < duration < 22
        or peak < 0.001
        or abs(duration - receipt["duration"]) > 0.12
    ):
        raise ValueError(
            "Empty, damaged or unexpectedly long recording: " + item["code"]
        )
    checked.append(
        {"file": item["file"], "seconds": round(duration, 3), "peak": round(peak, 4)}
    )
summary = {
    "decodedRecordings": len(checked),
    "cacheRecordings": len(manifest["entries"]),
    "samples": len(manifest["samples"]),
    "totalSeconds": round(sum(x["seconds"] for x in checked), 2),
    "longestSeconds": max(x["seconds"] for x in checked),
    "humanPronunciationReview": False,
}
(root / "audio-validation.json").write_text(
    json.dumps({"summary": summary, "recordings": checked}, indent=2), encoding="utf-8"
)
print(json.dumps(summary))
