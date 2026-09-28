import json
import os
import secrets
import tempfile
import time
import io
import wave

import numpy as np
from urllib.parse import quote

import folder_paths

from .client import Client, wait
from .errors import CheapBuddyError
from .images import tensor_images
from .models import parameters_json

MAX_VIDEO_BYTES = 512 * 1024 * 1024
MAX_AUDIO_BYTES = 128 * 1024 * 1024


def _video_bytes(video):
    if video is None:
        return None
    fd, name = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    try:
        video.save_to(name, format="mp4", codec="auto")
        with open(name, "rb") as stream:
            raw = stream.read(MAX_VIDEO_BYTES + 1)
        if len(raw) > MAX_VIDEO_BYTES:
            raise CheapBuddyError("Reference video exceeded the 512 MiB limit.")
        return raw
    finally:
        try:
            os.remove(name)
        except OSError:
            pass


def _audio_bytes(audio):
    if audio is None:
        return None
    if not isinstance(audio, dict) or "waveform" not in audio:
        raise CheapBuddyError("AUDIO input must be a ComfyUI audio object.")
    waveform = audio["waveform"].detach().cpu().numpy()
    if waveform.ndim == 3:
        waveform = waveform[0]
    if waveform.ndim == 1:
        waveform = waveform[None, :]
    if waveform.ndim != 2 or waveform.shape[0] > 8:
        raise CheapBuddyError("Audio reference must contain 1 to 8 channels.")
    sample_rate = int(audio.get("sample_rate", 0))
    if sample_rate < 8000 or sample_rate > 192000:
        raise CheapBuddyError("Audio reference sample rate is unsupported.")
    if waveform.shape[1] * waveform.shape[0] * 2 > MAX_AUDIO_BYTES:
        raise CheapBuddyError("Audio reference exceeded the 128 MiB limit.")
    pcm = (np.clip(waveform, -1, 1).T * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as stream:
        stream.setnchannels(waveform.shape[0])
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _frame_files(image_fields, first_images, last_images):
    if len(first_images) > 1 or len(last_images) > 1:
        raise CheapBuddyError("Video generation accepts one image per frame input.")

    frames = []
    if first_images:
        frames.append(("first", first_images[0]))
    if last_images:
        frames.append(("last", last_images[0]))
    if not frames:
        return []

    if image_fields:
        if len(frames) == 2 and len(image_fields) < 2:
            raise CheapBuddyError("Selected model schema needs separate image parameters for first and last frames.")
        unused = list(image_fields)
    else:
        unused = ["image", "last_frame"]

    first_names = {"first", "first_frame", "first_image", "start_frame", "start_image"}
    last_names = {"last", "last_frame", "last_image", "end_frame", "end_image"}
    files = []
    for role, raw in frames:
        aliases = first_names if role == "first" else last_names
        name = next((field for field in unused if field.lower() in aliases), None)
        if name is None:
            name = unused[0] if role == "first" or len(unused) == 1 else unused[-1]
        unused.remove(name)
        files.append((name, name + ".png", raw, "image/png"))
    return files


def _submit(client, model, operation, prompt, params, first_images, last_images, reference_video, reference_audio, detail):
    if model == "MiniMax-H3" and (first_images or last_images or reference_video is not None or reference_audio is not None):
        return _submit_h3_with_media_urls(client, model, operation, prompt, params, first_images, last_images, reference_video, reference_audio)

    fields = {"model": model, "prompt": prompt, "generation_type": operation}
    fields.update(params)
    files = []
    schema = detail.get("parameter_schema", {})
    image_fields = []
    video_fields = []
    audio_fields = []
    for name, rule in schema.items():
        if not isinstance(rule, dict):
            continue
        if rule.get("type") == "image":
            image_fields.append(name)
        elif rule.get("type") == "video":
            video_fields.append(name)
        elif rule.get("type") == "audio":
            audio_fields.append(name)
    # Stable generic field names keep known first/last frame APIs usable when
    # a model schema does not annotate media fields.
    files.extend(_frame_files(image_fields, first_images, last_images))
    if reference_video is not None:
        raw = _video_bytes(reference_video)
        name = video_fields[0] if video_fields else "video"
        files.append((name, "reference.mp4", raw, "video/mp4"))
    if reference_audio is not None:
        raw = _audio_bytes(reference_audio)
        name = audio_fields[0] if audio_fields else "audio"
        files.append((name, "reference.wav", raw, "audio/wav"))
    supplied_fields = {part[0] for part in files}
    for name, rule in schema.items():
        if isinstance(rule, dict) and rule.get("required") and rule.get("type") in ("image", "video", "audio") and name not in supplied_fields:
            raise CheapBuddyError("Model requires media parameter: %s" % name)
    if not files:
        return client.create_video(fields)
    from .images import multipart
    body, content_type = multipart(fields, files)
    return client.create_video(body, content_type=content_type)


def _submit_h3_with_media_urls(client, model, operation, prompt, params, first_images, last_images, reference_video, reference_audio):
    # EcoPhase accepts JSON media URLs. Uploading each ComfyUI input to the
    # relay's short-lived media store keeps the public task request below the
    # gateway timeout while avoiding a separate user-facing upload node.
    fields = {"model": model, "prompt": prompt, "generation_type": operation}
    fields.update(params)
    fields.pop("first_frame", None)
    fields.pop("last_frame", None)
    fields.pop("reference_video", None)
    fields.pop("reference_audio", None)
    if first_images:
        fields["first_frame"] = client.upload_media(first_images[0], "image/png")
    if last_images:
        fields["last_frame"] = client.upload_media(last_images[0], "image/png")
    if reference_video is not None:
        fields["reference_video"] = client.upload_media(_video_bytes(reference_video), "video/mp4")
    if reference_audio is not None:
        fields["reference_audio"] = client.upload_media(_audio_bytes(reference_audio), "audio/wav")
    return client.create_video(fields)


def _task_id(payload):
    if not isinstance(payload, dict):
        return ""
    data = payload.get("data")
    if not isinstance(data, dict):
        data = {}
    return str(payload.get("id") or payload.get("task_id") or data.get("id") or data.get("task_id") or "")


def _status(payload):
    if not isinstance(payload, dict):
        return "", ""
    data = payload.get("data")
    if not isinstance(data, dict):
        data = {}
    status = str(payload.get("status") or payload.get("task_status") or data.get("status") or data.get("task_status") or "").lower()
    return status, ""


def _save(client, task_id):
    route = "/v1/videos/%s/content" % quote(task_id, safe="")
    for attempt in range(2):
        try:
            raw, mime = client.download(route)
            break
        except CheapBuddyError as exc:
            if attempt or not str(exc).startswith("Could not download the video"):
                raise
            wait(1)
    if not mime.startswith(("video/", "application/octet-stream")):
        raise CheapBuddyError("Video content endpoint returned an unsupported MIME type.")
    output_dir = folder_paths.get_output_directory()
    os.makedirs(output_dir, exist_ok=True)
    extension = "webm" if "webm" in mime else "mp4"
    fd, temporary = tempfile.mkstemp(prefix=".cheapbuddy-", suffix=".part", dir=output_dir)
    os.close(fd)
    try:
        with open(temporary, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        filename = "CheapBuddy_%s.%s" % (secrets.token_hex(12), extension)
        target = os.path.join(output_dir, filename)
        os.replace(temporary, target)
        return target, filename
    finally:
        try:
            os.remove(temporary)
        except OSError:
            pass


def generate(base_url, api_key, model, operation, generation_type, prompt, task_id,
             parameters, image=None, last_frame=None, reference_video=None, wait_seconds=900, reference_audio=None):
    client = Client(base_url, api_key, timeout=60)
    detail = client.model(model)
    capability = generation_type
    if capability not in detail.get("capabilities", []):
        raise CheapBuddyError("Selected model does not advertise %s." % capability)
    params = parameters_json(parameters, detail)
    current_task = task_id.strip()
    if operation == "generate":
        if current_task:
            raise CheapBuddyError("Clear task_id before generate, or select resume to avoid duplicate submissions.")
        first_images = tensor_images(image)
        last_images = tensor_images(last_frame)
        if capability == "text_to_video" and (first_images or last_images or reference_video is not None or reference_audio is not None):
            raise CheapBuddyError("text_to_video does not accept image or video inputs.")
        if capability == "image_to_video" and not first_images:
            raise CheapBuddyError("image_to_video requires a first-frame IMAGE input.")
        if capability == "reference_to_video" and not (first_images or last_images or reference_video is not None or reference_audio is not None):
            raise CheapBuddyError("reference_to_video requires an image or reference video input.")
        payload = _submit(client, model, capability, prompt, params, first_images, last_images,
                          reference_video, reference_audio, detail)
        current_task = _task_id(payload)
        if not current_task:
            raise CheapBuddyError("Video create response did not contain a task ID.")
    elif operation != "resume":
        raise CheapBuddyError("operation must be generate or resume.")
    elif not current_task:
        raise CheapBuddyError("resume operation requires a task_id.")
    content_url = client.base_url + "/v1/videos/" + quote(current_task, safe="") + "/content"
    deadline = time.monotonic() + max(0, min(int(wait_seconds), 1800))
    delay = 2.0
    state = "queued"
    while True:
        payload = client.json("GET", "/v1/videos/" + quote(current_task, safe=""), timeout=60)
        state, message = _status(payload)
        if state in ("completed", "succeeded", "success", "done"):
            path, filename = _save(client, current_task)
            return path, content_url, path, "", current_task, state, filename
        if state in ("failed", "error", "cancelled", "canceled", "expired"):
            return "", content_url, "", message or ("Video task ended with status: " + state), current_task, state, ""
        if time.monotonic() >= deadline:
            return "", content_url, "", "", current_task, state or "processing", ""
        wait(delay)
        delay = min(delay * 1.5, 12.0)
