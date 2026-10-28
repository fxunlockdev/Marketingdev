"""Credential-free MP4 normalization stage; run ONLY in a network-disabled sandbox.

No supplied URLs, filenames, commands, filters or fonts are accepted. This stage
returns bytes, not a saved/approved creative. The parent owns tenant persistence.
"""
import base64
import hashlib
import json
import math
import platform
import re
import textwrap
from pathlib import Path
import resource
import signal
import subprocess
import sys
import tempfile

MAX_BYTES = 64 * 1024 * 1024
MAX_REQUEST = ((MAX_BYTES + 2) // 3) * 4 + 4096
VERSION = "desvio-video-render-v3/ffmpeg-7.1.5"
_LIBRARY = {"aarch64": "aarch64-linux-gnu", "x86_64": "x86_64-linux-gnu"}.get(platform.machine())
if _LIBRARY is None:
    raise RuntimeError("Unsupported isolated video architecture")
LIB = "/opt/video-deps/usr/lib/" + _LIBRARY
ENV = {"PATH": "/usr/bin:/bin", "HOME": "/tmp", "LANG": "C.UTF-8",
       "LD_LIBRARY_PATH": ":".join([LIB, LIB+"/pulseaudio", LIB+"/blas", LIB+"/lapack"])}
INPUT_OPTIONS = ["-protocol_whitelist", "file", "-format_whitelist", "mov", "-f", "mov",
                 "-enable_drefs", "0", "-use_absolute_path", "0", "-ignore_chapters", "1",
                 "-probesize", "5000000", "-analyzeduration", "5000000", "-err_detect", "explode", "-threads", "2"]


class Invalid(Exception):
    pass


def reject(code):
    raise Invalid(code)


def command(name, args, timeout=90, capture=False):
    # No shell. Only these fixed executables and code-owned argument lists.
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(["/opt/video-deps/usr/bin/"+name, *args],
                stdin=subprocess.DEVNULL, stdout=output if capture else subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, env=ENV, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            reject("VIDEO_MEDIA_TIMEOUT")
        if result.returncode != 0:
            reject("VIDEO_MEDIA_DECODE_FAILED")
        if capture:
            if output.tell() > 65536:
                reject("VIDEO_MEDIA_PROBE_LIMIT")
            output.seek(0)
            return output.read()


def number(value):
    try:
        value = float(value)
        if not math.isfinite(value):
            raise ValueError()
        return value
    except (ValueError, TypeError):
        reject("VIDEO_MEDIA_METADATA_INVALID")


def probe(path, expected):
    raw = command("ffprobe", ["-v", "error", "-max_alloc", "67108864", *INPUT_OPTIONS, "-show_entries",
        "format=duration:stream=index,codec_name,codec_type,width,height,pix_fmt,color_transfer,duration,start_time,r_frame_rate,sample_aspect_ratio,channels,sample_rate:stream_disposition=attached_pic:stream_side_data=side_data_type,rotation",
        "-of", "json", str(path)], timeout=20, capture=True)
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        reject("VIDEO_MEDIA_METADATA_INVALID")
    streams = data.get("streams", [])
    video = [s for s in streams if s.get("codec_type") == "video"]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    if len(video) != 1 or len(audio) > 1 or len(streams) != 1+len(audio):
        reject("VIDEO_MEDIA_STREAMS_INVALID")
    v = video[0]
    width, height = v.get("width"), v.get("height")
    if v.get("codec_name") not in {"h264", "hevc"} or not all(type(n) is int and 64 <= n <= 4096 for n in [width, height]) or width*height > 8388608:
        reject("VIDEO_MEDIA_DIMENSIONS_OR_CODEC_INVALID")
    if v.get("disposition", {}).get("attached_pic") or v.get("sample_aspect_ratio", "1:1") not in {"1:1", "N/A"} or any(s.get("side_data_type") == "Display Matrix" or number(s.get("rotation", 0)) != 0 for s in v.get("side_data_list", [])):
        reject("VIDEO_MEDIA_ORIENTATION_INVALID")
    if v.get("pix_fmt") != "yuv420p" or v.get("color_transfer", "unknown") not in {"unknown", "bt709", "smpte170m"}:
        reject("VIDEO_MEDIA_COLOR_UNSUPPORTED")
    try:
        numerator, denominator = v["r_frame_rate"].split("/")
        fps = number(numerator)/number(denominator)
    except (ValueError, KeyError, ZeroDivisionError):
        reject("VIDEO_MEDIA_METADATA_INVALID")
    if not 1 <= fps <= 60:
        reject("VIDEO_MEDIA_FRAME_RATE_INVALID")
    duration = number(data.get("format", {}).get("duration"))
    video_duration = number(v.get("duration", duration))
    if abs(duration-expected) > 0.25 or abs(video_duration-expected) > 0.25 or abs(number(v.get("start_time", 0))) > 0.05:
        reject("VIDEO_MEDIA_DURATION_MISMATCH")
    if audio:
        a = audio[0]
        if a.get("codec_name") != "aac" or type(a.get("channels")) is not int or not 1 <= a["channels"] <= 2 or not 8000 <= number(a.get("sample_rate")) <= 96000 or abs(number(a.get("duration", duration))-expected) > 0.25 or abs(number(a.get("start_time", 0))) > 0.05:
            reject("VIDEO_MEDIA_AUDIO_INVALID")
    return {"width": width, "height": height, "duration_ms": round(video_duration*1000), "audio": bool(audio), "codec": v["codec_name"]}


def validate_overlays(overlays, duration):
    if not isinstance(overlays, list) or len(overlays) > 3:
        reject("VIDEO_OVERLAY_INVALID")
    for overlay in overlays:
        if not isinstance(overlay, dict) or set(overlay) != {"text", "start_ms", "end_ms", "position", "foreground", "background"}:
            reject("VIDEO_OVERLAY_INVALID")
        if (not isinstance(overlay["text"], str) or not overlay["text"].strip() or len(overlay["text"]) > 90
            or any(ord(c) < 32 or ord(c) == 127 for c in overlay["text"])
            or overlay["position"] not in {"top", "bottom"}
            or not all(isinstance(overlay[k], str) and re.fullmatch(r"#[0-9a-fA-F]{6}", overlay[k]) for k in ["foreground", "background"])
            or not all(type(overlay[k]) is int for k in ["start_ms", "end_ms"])
            or not 0 <= overlay["start_ms"] <= overlay["end_ms"]-1000 <= duration*1000-1000):
            reject("VIDEO_OVERLAY_INVALID")
    for i, a in enumerate(overlays):
        for b in overlays[i+1:]:
            if a["position"] == b["position"] and a["start_ms"] < b["end_ms"] and b["start_ms"] < a["end_ms"]:
                reject("VIDEO_OVERLAY_INVALID")
    return overlays


def overlay_filters(overlays, root, width, height):
    # User text is a literal UTF-8 file, never part of a filter expression.
    # Font, file paths and all expressions are code-owned; colors/times validated.
    font = "/opt/video-deps/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
    size = max(12, round(min(width, height)/28))
    margin = max(8, round(min(width, height)*0.05))
    columns = min(36, max(8, int((width-4*margin)/(size*0.7))))
    filters = []
    for i, overlay in enumerate(overlays):
        text = "\n".join(textwrap.wrap(overlay["text"], columns, break_long_words=True, break_on_hyphens=False))
        if len(text.splitlines()) > 4 or len(text.splitlines())*size*1.4+2*margin > height/2:
            reject("VIDEO_OVERLAY_LAYOUT_LIMIT")
        path = root/f"overlay-{i}.txt"
        path.write_text(text, encoding="utf-8")
        y = str(margin) if overlay["position"] == "top" else f"h-text_h-{margin}"
        filters.append(f"drawtext=fontfile={font}:textfile={path}:expansion=none:fontsize={size}:fontcolor=0x{overlay['foreground'][1:]}:box=1:boxcolor=0x{overlay['background'][1:]}:boxborderw={max(3,margin//2)}:x=(w-text_w)/2:y={y}:enable='gte(t,{overlay['start_ms']/1000})*lt(t,{overlay['end_ms']/1000})'")
    return filters


def run(value):
    if not isinstance(value, dict) or set(value) not in ({"version", "input_base64", "input_sha256", "expected_duration_seconds"}, {"version", "input_base64", "input_sha256", "expected_duration_seconds", "overlays"}, {"version", "input_base64", "input_sha256", "expected_duration_seconds", "overlays", "target"}) or value["version"] != 1 or type(value["expected_duration_seconds"]) is not int or not 3 <= value["expected_duration_seconds"] <= 15 or not isinstance(value["input_base64"], str) or len(value["input_base64"]) > MAX_REQUEST-4096:
        reject("VIDEO_MEDIA_INPUT_INVALID")
    try:
        source = base64.b64decode(value["input_base64"], validate=True)
    except ValueError:
        reject("VIDEO_MEDIA_INPUT_INVALID")
    if not 24 <= len(source) <= MAX_BYTES or hashlib.sha256(source).hexdigest() != value["input_sha256"]:
        reject("VIDEO_MEDIA_INPUT_INVALID")
    # Force ISO BMFF and reject manifests, HTML, image files and arbitrary URLs
    # before the demuxer; full parsing and decoding still happen below.
    if source[4:8] != b"ftyp":
        reject("VIDEO_MEDIA_CONTAINER_INVALID")
    expected = value["expected_duration_seconds"]
    target = value.get("target")
    if target is not None and (not isinstance(target, dict) or set(target) != {"width", "height"} or type(target["width"]) is not int or type(target["height"]) is not int or (target["width"], target["height"]) not in {(1024,1024),(1024,1536),(1536,1024),(1080,1920)}):
        reject("VIDEO_TARGET_INVALID")
    overlays = validate_overlays(value.get("overlays", []), expected)
    with tempfile.TemporaryDirectory(prefix="desvio-video-") as folder:
        root = Path(folder)
        original, canonical, thumb = root/"source.mp4", root/"canonical.mp4", root/"poster.png"
        original.write_bytes(source)
        metadata = probe(original, expected)
        ratio = min(1, 1920/max(metadata["width"], metadata["height"]), 1080/min(metadata["width"], metadata["height"]))
        width, height = [max(2, int(n*ratio)//2*2) for n in [metadata["width"], metadata["height"]]]
        if target:
            width, height = target["width"], target["height"]
            filters = [f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos", f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black", "setsar=1", *overlay_filters(overlays, root, width, height)]
        else:
            filters = [f"scale={width}:{height}:flags=lanczos", "setsar=1", *overlay_filters(overlays, root, width, height)]
        command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-xerror", "-max_error_rate", "0", "-max_alloc", "67108864", "-filter_threads", "1",
            *INPUT_OPTIONS, "-i", str(original), "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
            "-vf", ",".join(filters), "-r", "30", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level:v", "4.1", "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k",
            "-max_muxing_queue_size", "128", "-movflags", "+faststart", "-f", "mp4", str(canonical)])
        saved = probe(canonical, expected)
        if saved["width"] != width or saved["height"] != height or saved["codec"] != "h264" or saved["audio"] != metadata["audio"]:
            reject("VIDEO_MEDIA_OUTPUT_INVALID")
        # Decode the complete canonical stream again. The poster alone is never
        # treated as proof that the rest of a clip is valid.
        command("ffmpeg", ["-v", "error", "-nostdin", "-xerror", *INPUT_OPTIONS, "-i", str(canonical), "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"], timeout=60)
        command("ffmpeg", ["-v", "error", "-nostdin", "-xerror", "-filter_threads", "1", *INPUT_OPTIONS, "-i", str(canonical), "-map", "0:v:0", "-frames:v", "1",
            "-vf", "scale=640:640:force_original_aspect_ratio=decrease", "-threads", "1", "-update", "1", str(thumb)], timeout=20)
        if not 24 <= canonical.stat().st_size <= MAX_BYTES or not 24 <= thumb.stat().st_size <= 2*1024*1024:
            reject("VIDEO_MEDIA_OUTPUT_LIMIT")
        clip, poster = canonical.read_bytes(), thumb.read_bytes()
        return {"type": "result", "version": VERSION, "overlays": overlays, "target": target, "input_sha256": value["input_sha256"], "metadata": saved,
                "video": {"mime": "video/mp4", "sha256": hashlib.sha256(clip).hexdigest(), "base64": base64.b64encode(clip).decode()},
                "poster": {"mime": "image/png", "sha256": hashlib.sha256(poster).hexdigest(), "base64": base64.b64encode(poster).decode()}}


if __name__ == "__main__":
    signal.alarm(180)
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    try:
        line = sys.stdin.buffer.readline(MAX_REQUEST+1)
        if not line or len(line) > MAX_REQUEST:
            reject("VIDEO_MEDIA_INPUT_LIMIT")
        result = run(json.loads(line))
        print(json.dumps(result, separators=(",", ":")))
    except Exception as error:
        code = str(error) if isinstance(error, Invalid) else "VIDEO_MEDIA_FAILED"
        print(json.dumps({"type": "error", "code": code}))
        sys.exit(1)
