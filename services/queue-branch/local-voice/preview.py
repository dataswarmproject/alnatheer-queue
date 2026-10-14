"""Create listening samples from the exact two-part recordings used on the TV."""

import argparse
import hashlib
import html
import json
import pathlib
import subprocess

import imageio_ffmpeg
import numpy as np
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("--library", required=True)
args = parser.parse_args()
root = pathlib.Path(args.library).resolve()
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
report = json.loads((root / "generation-report.json").read_text(encoding="utf-8"))
rows = []
for sample in manifest["samples"]:
    ticket = next(
        x
        for x in manifest["entries"]
        if x["code"] == "A-" + str(int(sample["code"].split("-")[1]))
    )
    destination = next(
        x
        for x in manifest["entries"]
        if x["code"] == "DESTINATION" and x["counterName"] == sample["counterName"]
    )
    segments = []
    rate = None
    for entry in [ticket, destination]:
        source = root / entry["file"]
        receipt = report["recordings"][entry["file"]]
        if hashlib.sha256(source.read_bytes()).hexdigest() != receipt["sha256"]:
            raise ValueError("Recording checksum mismatch")
        audio, audio_rate = sf.read(source, dtype="float32")
        if rate is not None and audio_rate != rate:
            raise ValueError("Sample rates differ")
        if not np.isfinite(audio).all() or audio.ndim != 1:
            raise ValueError("Invalid decoded recording")
        rate = audio_rate
        segments.append(audio)
    joined = np.concatenate(
        [segments[0], np.zeros(round(rate * 0.12), dtype="float32"), segments[1]]
    )
    target = root / sample["file"].replace(".mp3", "-combined.mp3")
    wave = target.with_suffix(".temporary.wav")
    try:
        sf.write(wave, joined, rate, subtype="PCM_16")
        subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(wave),
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "128k",
                str(target),
            ],
            check=True,
            timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    finally:
        wave.unlink(missing_ok=True)
    label = html.escape(sample["code"] + " → " + sample["counterName"])
    rows.append(
        f'<section><h2 dir="ltr">{label}</h2><p>النداء المركّب المستخدم في النظام</p><audio controls preload="metadata" src="{html.escape(target.relative_to(root).as_posix())}"></audio><details><summary>مقارنة بقراءة الجملة كاملة</summary><audio controls preload="metadata" src="{html.escape(sample["file"])}"></audio></details></section>'
    )
page = (
    """<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>عينات النداء العربي · النذير</title><style>body{margin:40px auto;padding:0 20px;max-width:780px;font:17px/1.7 Segoe UI,Arial;background:#fafafa;color:#171717}h1{font-size:28px}section{margin:18px 0;background:white;border:1px solid #ddd;border-radius:14px;padding:20px}h2{margin:0;font-size:20px}p{color:#555}audio{width:100%;margin:10px 0}summary{cursor:pointer;font-size:15px}</style><h1>عينات النداء العربي · النذير</h1><p>تسجيلات محلية تعمل دون اشتراك. اختبر وضوح حرف A، رقم التذكرة والكاونتر، والسلاسة بين الجزأين.</p>"""
    + "".join(rows)
    + "</html>"
)
(root / "pronunciation-samples.html").write_text(page, encoding="utf-8")
print(
    json.dumps(
        {
            "combinedSamples": len(rows),
            "page": str(root / "pronunciation-samples.html"),
        },
        ensure_ascii=False,
    )
)
