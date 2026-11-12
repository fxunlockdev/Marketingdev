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
# A reel carries up to five canonical shot clips; their sum is bounded separately.
MAX_REEL_INPUT = 160 * 1024 * 1024
MAX_REEL_REQUEST = ((MAX_REEL_INPUT + 2) // 3) * 4 + 65536
TARGETS = {(1024, 1024), (1024, 1536), (1536, 1024), (1080, 1920), (1024, 1280), (1080, 1350)}
# Quality-preserving H.264: visually transparent CRF, bounded peak bitrate, no
# forced frame rate. Level 4.2 admits 1080x1920 at up to 60 frames per second.
ENCODE = ["-c:v", "libx264", "-threads", "2", "-preset", "medium", "-crf", "17", "-maxrate", "25M", "-bufsize", "50M",
          "-pix_fmt", "yuv420p", "-profile:v", "high", "-level:v", "4.2"]
FONTS = {"sans": "/opt/video-deps/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
         "serif": "/opt/video-deps/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"}
VERSION = "desvio-video-render-v4/ffmpeg-7.1.5"
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
    # Runway may return HEVC 10-bit SDR. Bit depth alone does not imply HDR.
    # Accept only explicitly SDR-tagged 10-bit input; retain the HDR/unknown
    # 10-bit rejection until a separately verified tone-mapping path exists.
    transfer = v.get("color_transfer", "unknown")
    supported_pixels = v.get("pix_fmt") == "yuv420p" or (v.get("pix_fmt") == "yuv420p10le" and transfer in {"bt709", "smpte170m"})
    if not supported_pixels or transfer not in {"unknown", "bt709", "smpte170m"}:
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


COLOR = re.compile(r"#[0-9a-fA-F]{6}")


def plain_text(value, limit):
    return isinstance(value, str) and value.strip() and len(value) <= limit and not any(ord(c) < 32 or ord(c) == 127 for c in value)


def validate_captions(captions, total_ms):
    # Burned-in captions from the approved script, timed to beats on the reel timeline.
    if not isinstance(captions, list) or len(captions) > 12:
        reject("VIDEO_CAPTION_INVALID")
    end = 0
    for caption in captions:
        if (not isinstance(caption, dict) or set(caption) != {"text", "start_ms", "end_ms"} or not plain_text(caption["text"], 120)
            or not all(type(caption[k]) is int for k in ["start_ms", "end_ms"]) or caption["start_ms"] < end
            or caption["end_ms"] - caption["start_ms"] < 800 or caption["end_ms"] > total_ms):
            reject("VIDEO_CAPTION_INVALID")
        end = caption["end_ms"]
    return captions


def validate_reel(value):
    keys = {"version", "mode", "clips", "target", "captions", "overlays", "end_card", "style", "audio", "samples"}
    if not isinstance(value, dict) or set(value) != keys or value["version"] != 2 or value["mode"] != "reel":
        reject("VIDEO_REEL_INVALID")
    clips, target = value["clips"], value["target"]
    if not isinstance(clips, list) or not 1 <= len(clips) <= 5:
        reject("VIDEO_REEL_INVALID")
    if not isinstance(target, dict) or set(target) != {"width", "height"} or (target.get("width"), target.get("height")) not in TARGETS:
        reject("VIDEO_TARGET_INVALID")
    total_input = 0
    for clip in clips:
        if (not isinstance(clip, dict) or set(clip) != {"input_base64", "input_sha256", "duration_seconds"} or type(clip["duration_seconds"]) is not int
            or not 3 <= clip["duration_seconds"] <= 15 or not isinstance(clip["input_base64"], str) or not isinstance(clip["input_sha256"], str)):
            reject("VIDEO_REEL_INVALID")
        total_input += len(clip["input_base64"]) * 3 // 4
    if total_input > MAX_REEL_INPUT:
        reject("VIDEO_MEDIA_INPUT_LIMIT")
    card = value["end_card"]
    if card is not None and (not isinstance(card, dict) or set(card) != {"headline", "cta", "foreground", "background", "duration_ms"}
        or not plain_text(card["headline"], 60) or not (card["cta"] == "" or plain_text(card["cta"], 60))
        or not all(isinstance(card[k], str) and COLOR.fullmatch(card[k]) for k in ["foreground", "background"])
        or card["duration_ms"] not in {1000, 2000, 3000, 4000} or type(card["duration_ms"]) is not int):
        reject("VIDEO_END_CARD_INVALID")
    style = value["style"]
    if (not isinstance(style, dict) or set(style) != {"font", "caption_scale", "caption_foreground", "caption_background", "caption_opacity"}
        or style["font"] not in FONTS or style["caption_scale"] not in {100, 130}
        or not all(isinstance(style[k], str) and COLOR.fullmatch(style[k]) for k in ["caption_foreground", "caption_background"])
        or style["caption_opacity"] not in {70, 100}):
        reject("VIDEO_STYLE_INVALID")
    # Audio seam: a silent stereo bed today; a licensed music bed or voiceover
    # will arrive as a code-owned asset, never as a caller-supplied URL.
    if value["audio"] != {"bed": "silence"}:
        reject("VIDEO_AUDIO_INVALID")
    shots_ms = sum(c["duration_seconds"] for c in clips) * 1000
    total_ms = shots_ms + (card["duration_ms"] if card else 0)
    if total_ms > 60000:
        reject("VIDEO_REEL_INVALID")
    validate_captions(value["captions"], shots_ms)
    validate_overlays(value["overlays"], total_ms / 1000)
    samples = value["samples"]
    if not isinstance(samples, list) or len(samples) > 6 or any(type(t) is not int or not 0 <= t < total_ms for t in samples):
        reject("VIDEO_REEL_INVALID")
    return total_ms


def text_filter(path, font, size, foreground, background, opacity, y, margin, start_ms, end_ms):
    alpha = "" if opacity == 100 else f"@{opacity/100:.2f}"
    return (f"drawtext=fontfile={font}:textfile={path}:expansion=none:fontsize={size}:fontcolor=0x{foreground[1:]}:line_spacing={max(2,size//5)}"
            f":box=1:boxcolor=0x{background[1:]}{alpha}:boxborderw={max(4,margin//2)}:x=(w-text_w)/2:y={y}"
            f":enable='gte(t,{start_ms/1000})*lt(t,{end_ms/1000})'")


def caption_filters(captions, style, root, width, height):
    font = FONTS[style["font"]]
    size = max(14, round(min(width, height) / 22 * style["caption_scale"] / 100))
    margin = max(8, round(min(width, height) * 0.05))
    columns = min(32, max(8, int((width - 4 * margin) / (size * 0.62))))
    filters = []
    for i, caption in enumerate(captions):
        text = "\n".join(textwrap.wrap(caption["text"], columns, break_long_words=True, break_on_hyphens=False))
        if len(text.splitlines()) > 3:
            reject("VIDEO_CAPTION_LAYOUT_LIMIT")
        path = root/f"caption-{i}.txt"
        path.write_text(text, encoding="utf-8")
        # Lower third, above the bottom overlay band and platform UI.
        filters.append(text_filter(path, font, size, style["caption_foreground"], style["caption_background"], style["caption_opacity"],
                                   f"h*0.72-text_h/2", margin, caption["start_ms"], caption["end_ms"]))
    return filters


def end_card_source(card, style, root, width, height, fps, index):
    font = FONTS[style["font"]]
    head = max(18, round(min(width, height) / 12))
    cta = max(14, round(min(width, height) / 22))
    (root/"card-headline.txt").write_text("\n".join(textwrap.wrap(card["headline"], 18, break_long_words=True)), encoding="utf-8")
    seconds = card["duration_ms"] / 1000
    chain = (f"color=c=0x{card['background'][1:]}:size={width}x{height}:rate={fps}:duration={seconds},format=yuv420p,"
             f"drawtext=fontfile={font}:textfile={root/'card-headline.txt'}:expansion=none:fontsize={head}:fontcolor=0x{card['foreground'][1:]}:x=(w-text_w)/2:y=h*0.42-text_h/2")
    if card["cta"]:
        (root/"card-cta.txt").write_text(card["cta"], encoding="utf-8")
        chain += (f",drawtext=fontfile={font}:textfile={root/'card-cta.txt'}:expansion=none:fontsize={cta}:fontcolor=0x{card['background'][1:]}"
                  f":box=1:boxcolor=0x{card['foreground'][1:]}:boxborderw={max(6,cta//2)}:x=(w-text_w)/2:y=h*0.62")
    return chain + f",setsar=1[v{index}]"


def run_reel(value):
    total_ms = validate_reel(value)
    target, style, card = value["target"], value["style"], value["end_card"]
    width, height = target["width"], target["height"]
    with tempfile.TemporaryDirectory(prefix="desvio-reel-") as folder:
        root = Path(folder)
        paths, rates = [], []
        for i, clip in enumerate(value["clips"]):
            try:
                data = base64.b64decode(clip["input_base64"], validate=True)
            except ValueError:
                reject("VIDEO_MEDIA_INPUT_INVALID")
            if not 24 <= len(data) <= MAX_BYTES or hashlib.sha256(data).hexdigest() != clip["input_sha256"] or data[4:8] != b"ftyp":
                reject("VIDEO_MEDIA_INPUT_INVALID")
            path = root/f"shot-{i}.mp4"
            path.write_bytes(data)
            meta = probe(path, clip["duration_seconds"])
            info = json.loads(command("ffprobe", ["-v", "error", *INPUT_OPTIONS, "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "json", str(path)], timeout=20, capture=True))
            numerator, denominator = info["streams"][0]["r_frame_rate"].split("/")
            rates.append(number(numerator) / number(denominator))
            paths.append((path, meta))
        # Keep the shots' own frame rate when they agree; otherwise cut at 30 fps.
        fps = round(rates[0], 3) if all(abs(r - rates[0]) < 0.01 for r in rates) else 30
        inputs, chains, labels = [], [], []
        for i, (path, meta) in enumerate(paths):
            inputs += [*INPUT_OPTIONS, "-i", str(path)]
            chains.append(f"[{i}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p,trim=duration={value['clips'][i]['duration_seconds']},setpts=PTS-STARTPTS[v{i}]")
            labels.append(f"[v{i}]")
        if card:
            chains.append(end_card_source(card, style, root, width, height, fps, len(paths)))
            labels.append(f"[v{len(paths)}]")
        text = [*caption_filters(value["captions"], style, root, width, height), *overlay_filters(value["overlays"], root, width, height)]
        chains.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=0" + ("," + ",".join(text) if text else "") + "[out]")
        chains.append(f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={total_ms/1000}[aud]")
        output, thumb = root/"reel.mp4", root/"poster.png"
        command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-xerror", "-max_alloc", "134217728", "-filter_threads", "1", *inputs,
            "-filter_complex", ";".join(chains), "-map", "[out]", "-map", "[aud]", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
            *ENCODE, "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k", "-shortest", "-max_muxing_queue_size", "512", "-movflags", "+faststart", "-f", "mp4", str(output)], timeout=280)
        saved = probe(output, total_ms // 1000)
        if saved["width"] != width or saved["height"] != height or saved["codec"] != "h264" or not saved["audio"]:
            reject("VIDEO_MEDIA_OUTPUT_INVALID")
        command("ffmpeg", ["-v", "error", "-nostdin", "-xerror", *INPUT_OPTIONS, "-i", str(output), "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], timeout=120)
        command("ffmpeg", ["-v", "error", "-nostdin", "-xerror", "-filter_threads", "1", *INPUT_OPTIONS, "-i", str(output), "-map", "0:v:0", "-frames:v", "1",
            "-vf", "scale=640:640:force_original_aspect_ratio=decrease", "-threads", "1", "-update", "1", str(thumb)], timeout=20)
        samples = []
        for i, at in enumerate(value["samples"]):
            frame = root/f"sample-{i}.png"
            command("ffmpeg", ["-v", "error", "-nostdin", "-xerror", "-filter_threads", "1", "-ss", f"{at/1000:.3f}", *INPUT_OPTIONS, "-i", str(output), "-map", "0:v:0", "-frames:v", "1",
                "-vf", "scale=1024:1024:force_original_aspect_ratio=decrease", "-threads", "1", "-update", "1", str(frame)], timeout=20)
            data = frame.read_bytes()
            samples.append({"at_ms": at, "mime": "image/png", "sha256": hashlib.sha256(data).hexdigest(), "base64": base64.b64encode(data).decode()})
        if not 24 <= output.stat().st_size <= MAX_BYTES or not 24 <= thumb.stat().st_size <= 2*1024*1024:
            reject("VIDEO_MEDIA_OUTPUT_LIMIT")
        clip, poster = output.read_bytes(), thumb.read_bytes()
        return {"type": "result", "version": VERSION, "mode": "reel", "fps": fps, "metadata": saved,
                "inputs": [c["input_sha256"] for c in value["clips"]], "captions": value["captions"], "overlays": value["overlays"], "end_card": card, "style": style, "target": target,
                "video": {"mime": "video/mp4", "sha256": hashlib.sha256(clip).hexdigest(), "base64": base64.b64encode(clip).decode()},
                "poster": {"mime": "image/png", "sha256": hashlib.sha256(poster).hexdigest(), "base64": base64.b64encode(poster).decode()},
                "samples": samples}


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
    if target is not None and (not isinstance(target, dict) or set(target) != {"width", "height"} or type(target["width"]) is not int or type(target["height"]) is not int or (target["width"], target["height"]) not in TARGETS):
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
            "-vf", ",".join(filters), *ENCODE, "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k",
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
    signal.alarm(300)
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (280, 280))
    try:
        line = sys.stdin.buffer.readline(MAX_REEL_REQUEST+1)
        if not line or len(line) > MAX_REEL_REQUEST:
            reject("VIDEO_MEDIA_INPUT_LIMIT")
        request = json.loads(line)
        if isinstance(request, dict) and request.get("mode") == "reel":
            result = run_reel(request)
        elif len(line) > MAX_REQUEST:
            reject("VIDEO_MEDIA_INPUT_LIMIT")
        else:
            result = run(request)
        print(json.dumps(result, separators=(",", ":")))
    except Exception as error:
        code = str(error) if isinstance(error, Invalid) else "VIDEO_MEDIA_FAILED"
        print(json.dumps({"type": "error", "code": code}))
        sys.exit(1)
