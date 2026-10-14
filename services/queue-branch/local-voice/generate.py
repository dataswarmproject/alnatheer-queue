"""Offline Arabic library generation. No API credentials, remote speech calls or database access."""

import argparse
import hashlib
import json
import os
import pathlib
import random
import shutil
import subprocess
import time


def cache_key(voice, model, text):
    payload = json.dumps(
        {"version": 2, "voice": voice, "model": model, "text": text},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def atomic_json(file, value):
    temporary = file.with_suffix(file.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(temporary, file)


def publish_completion(output, manifest, report):
    prepared = sum((output / x["file"]).exists() for x in manifest["entries"])
    complete = prepared == len(manifest["entries"])
    if complete:
        for item in manifest["entries"]:
            receipt = report["recordings"].get(item["file"])
            if (
                not receipt
                or hashlib.sha256((output / item["file"]).read_bytes()).hexdigest()
                != receipt["sha256"]
            ):
                raise ValueError("Completed audio is unverified: " + item["file"])
    report["complete"] = complete
    report["preparedClips"] = prepared
    atomic_json(output / "generation-report.json", report)
    if complete:
        atomic_json(
            output / "speech-cache" / "voice-library.json",
            {
                "version": 1,
                "voiceId": manifest["voiceId"],
                "model": manifest["model"],
                "complete": True,
                "recordings": manifest["totalClips"],
            },
        )
    return {
        "complete": complete,
        "preparedClips": prepared,
        "expectedClips": manifest["totalClips"],
        "paidProvider": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-new-clips", type=int, required=True)
    parser.add_argument("--samples-only", action="store_true")
    args = parser.parse_args()
    output = pathlib.Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    if (
        manifest["model"] != "chatterbox_multilingual_v3"
        or not manifest["engine"]["builtInVoice"]
    ):
        raise ValueError("Unsupported local library configuration")
    entries = manifest["entries"]
    if args.samples_only:
        entries = [
            x
            for x in entries
            if x["code"]
            in ("AUDIO TEST", "DESTINATION", "A-1", "A-23", "A-101", "A-999")
        ]
    items = [*manifest["samples"], *entries]
    for item in items:
        if item["key"] != cache_key(
            manifest["voiceId"], manifest["model"], item["text"]
        ):
            raise ValueError("Voice cache key mismatch")
        target = (output / item["file"]).resolve()
        if output not in target.parents or not item["file"].endswith(".mp3"):
            raise ValueError("Output outside library")
    missing = [x for x in items if not (output / x["file"]).exists()]
    if not 0 <= len(missing) <= args.max_new_clips <= 10100:
        raise ValueError("Generation exceeds the explicit new-clip limit")
    if shutil.disk_usage(output).free < 1024**3:
        raise ValueError("Keep at least 1 GiB free before generation")
    report_file = output / "generation-report.json"
    report = (
        json.loads(report_file.read_text(encoding="utf-8"))
        if report_file.exists()
        else {
            "complete": False,
            "voiceId": manifest["voiceId"],
            "model": manifest["model"],
            "engine": manifest["engine"],
            "recordings": {},
        }
    )
    if report["voiceId"] != manifest["voiceId"]:
        raise ValueError("Output contains a different voice")
    if not missing:
        for item in items:
            saved = report["recordings"].get(item["file"])
            if (
                not saved
                or hashlib.sha256((output / item["file"]).read_bytes()).hexdigest()
                != saved["sha256"]
            ):
                raise ValueError("Existing audio is unverified: " + item["file"])
        result = publish_completion(output, manifest, report)
        print(json.dumps({**result, "newClips": 0, "reused": len(items)}), flush=True)
        return
    # Pretrained files are installed separately and verified against the pinned upstream hashes.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import imageio_ffmpeg
    import numpy as np
    import soundfile as sf
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    if not torch.cuda.is_available():
        raise RuntimeError("GPU generation unavailable; install CUDA PyTorch")
    torch.set_num_threads(4)
    model = ChatterboxMultilingualTTS.from_local(
        args.models, device="cuda", t3_model="v3"
    )
    encoder = imageio_ffmpeg.get_ffmpeg_exe()
    for index, item in enumerate(items):
        target = output / item["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        saved = report["recordings"].get(item["file"])
        if target.exists():
            if (
                not saved
                or hashlib.sha256(target.read_bytes()).hexdigest() != saved["sha256"]
            ):
                raise ValueError("Existing audio is unverified: " + item["file"])
            continue
        if shutil.disk_usage(output).free < 768 * 1024**2:
            raise ValueError("Audio output disk is nearly full")
        started = time.monotonic()
        seed = 42 + int(item["key"][:8], 16) % 1000000
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        wav = model.generate(
            item["text"],
            language_id="ar",
            cfg_weight=0,
            exaggeration=0.3,
            temperature=0.65,
        )
        samples = wav.squeeze().cpu().numpy()
        duration = len(samples) / model.sr
        if (
            not np.isfinite(samples).all()
            or not 0.3 < duration < 22
            or float(np.max(np.abs(samples))) < 0.001
        ):
            raise ValueError("Invalid or unexpectedly long speech: " + item["code"])
        temporary_wave = target.with_suffix(".temporary.wav")
        temporary_mp3 = target.with_suffix(".temporary.mp3")
        try:
            sf.write(temporary_wave, samples, model.sr, subtype="PCM_16")
            subprocess.run(
                [
                    encoder,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(temporary_wave),
                    "-codec:a",
                    "libmp3lame",
                    "-b:a",
                    "128k",
                    str(temporary_mp3),
                ],
                check=True,
                timeout=30,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            audio = temporary_mp3.read_bytes()
            if not 100 <= len(audio) <= 2 * 1024 * 1024 or not (
                audio.startswith(b"ID3") or (audio[0] == 255 and audio[1] & 224 == 224)
            ):
                raise ValueError("Invalid MP3 output")
            elapsed = time.monotonic() - started
            report["recordings"][item["file"]] = {
                "code": item["code"],
                "counterName": item["counterName"],
                "text": item["text"],
                "sha256": hashlib.sha256(audio).hexdigest(),
                "bytes": len(audio),
                "duration": round(duration, 3),
                "generationSeconds": round(elapsed, 3),
                "seed": seed,
            }
            # Persist the receipt first, so an interruption after publishing can resume safely.
            atomic_json(report_file, report)
            os.replace(temporary_mp3, target)
        finally:
            temporary_wave.unlink(missing_ok=True)
            temporary_mp3.unlink(missing_ok=True)
        print(
            json.dumps(
                {
                    "ready": len(report["recordings"]),
                    "code": item["code"],
                    "counter": item["counterName"],
                    "seconds": round(elapsed, 2),
                    "duration": round(duration, 2),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    print(json.dumps(publish_completion(output, manifest, report)), flush=True)


if __name__ == "__main__":
    main()
