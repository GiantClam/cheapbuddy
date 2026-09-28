import json
import secrets
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .errors import CheapBuddyError, safe_error

USER_AGENT = "ComfyUI-CheapBuddy/0.1.0"
MAX_JSON_BYTES = 64 * 1024 * 1024


class Client:
    def __init__(self, base_url, api_key, timeout=60):
        self.base_url = base_url.strip().rstrip("/") if isinstance(base_url, str) else ""
        self.api_key = api_key.strip() if isinstance(api_key, str) else ""
        self.timeout = max(1, min(int(timeout), 900))
        parsed = urlsplit(self.base_url)
        if parsed.scheme not in ("https", "http") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise CheapBuddyError("base_url must use HTTP or HTTPS.")
        if not self.api_key:
            raise CheapBuddyError("Enter an API Key on this node.")

    def request(self, method, route, payload=None, content_type=None, timeout=None, extra_headers=None, raw=False):
        request_id = secrets.token_hex(16)
        body = payload
        headers = {
            "Authorization": "Bearer " + self.api_key,
            "User-Agent": USER_AGENT,
            "X-Request-ID": request_id,
            "Accept": "application/json",
        }
        if isinstance(payload, (dict, list)):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif content_type:
            headers["Content-Type"] = content_type
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(self.base_url + route, data=body, headers=headers, method=method)
        try:
            with urllib.request.build_opener(_NoRedirect()).open(req, timeout=timeout or self.timeout) as response:
                data = response.read(MAX_JSON_BYTES + 1)
                if len(data) > MAX_JSON_BYTES:
                    raise CheapBuddyError("CheapBuddy response exceeded the 64 MiB limit.")
                if raw:
                    return data, response.headers.get("Content-Type", "application/octet-stream")
                if response.status == 204:
                    return {}
                return json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            rid = exc.headers.get("X-Request-ID", request_id)
            task_id = ""
            try:
                error_body = exc.read(MAX_JSON_BYTES + 1)
                if len(error_body) <= MAX_JSON_BYTES:
                    task_id = _task_id_from_payload(json.loads(error_body.decode("utf-8")))
            except (OSError, ValueError, UnicodeError):
                pass
            raise CheapBuddyError(safe_error(exc.code, rid), status=exc.code, task_id=task_id) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise CheapBuddyError("Could not reach CheapBuddy (%s). Request ID: %s" % (type(exc).__name__, request_id)) from None
        except (ValueError, UnicodeError):
            raise CheapBuddyError("CheapBuddy returned an invalid JSON response. Request ID: %s" % request_id) from None

    def models(self, capabilities=()):
        payload = self.request("GET", "/v1/models")
        rows = payload.get("data", []) if isinstance(payload, dict) else []
        return [item for item in rows if isinstance(item, dict) and supports(item, capabilities)]

    def model(self, model_id):
        from urllib.parse import quote
        result = self.request("GET", "/v1/models/" + quote(model_id, safe=""))
        if not isinstance(result, dict) or result.get("id") != model_id:
            raise CheapBuddyError("Model detail response did not match the selected model.")
        return result

    def json(self, method, route, payload=None, timeout=None):
        return self.request(method, route, payload, timeout=timeout)

    def create_video(self, payload, content_type=None):
        headers = {"Idempotency-Key": secrets.token_hex(24)}
        for attempt in range(15):
            try:
                return self.request("POST", "/v1/videos", payload, content_type=content_type,
                                    timeout=180, extra_headers=headers)
            except CheapBuddyError as exc:
                message = str(exc)
                if exc.status == 409 and exc.task_id:
                    return {"id": exc.task_id, "task_id": exc.task_id, "status": "in_progress"}
                recoverable = message.startswith("Could not reach CheapBuddy") or any(
                    "HTTP %s" % status in message for status in (409, 502, 504)
                )
                if not recoverable or attempt == 14:
                    raise
                time.sleep(2)

    def upload_media(self, raw, mime_type):
        if not isinstance(raw, (bytes, bytearray)) or not raw:
            raise CheapBuddyError("Media input is empty.")
        if not isinstance(mime_type, str) or not mime_type.startswith(("image/", "video/", "audio/")):
            raise CheapBuddyError("Media input has an unsupported MIME type.")
        result = self.request("POST", "/v1/media", bytes(raw), content_type=mime_type, timeout=180)
        url = result.get("url") if isinstance(result, dict) else None
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            raise CheapBuddyError("CheapBuddy media upload did not return a usable URL.")
        return url

    def download(self, route, max_bytes=512 * 1024 * 1024, timeout=300):
        request_id = secrets.token_hex(16)
        headers = {"Authorization": "Bearer " + self.api_key, "User-Agent": USER_AGENT,
                   "X-Request-ID": request_id, "Accept": "video/*, application/octet-stream"}
        req = urllib.request.Request(self.base_url + route, headers=headers, method="GET")
        total_timeout = min(max(1, timeout), 900)
        deadline = time.monotonic() + total_timeout
        try:
            with urllib.request.build_opener(_NoRedirect()).open(req, timeout=min(total_timeout, 45)) as response:
                chunks, size = [], 0
                read_available = getattr(response, "read1", response.read)
                while True:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Video download exceeded its total time limit")
                    chunk = read_available(64 * 1024)
                    if not chunk:
                        break
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Video download exceeded its total time limit")
                    size += len(chunk)
                    if size > max_bytes:
                        raise CheapBuddyError("Video response exceeded the 512 MiB limit.")
                    chunks.append(chunk)
                return b"".join(chunks), response.headers.get("Content-Type", "application/octet-stream")
        except urllib.error.HTTPError as exc:
            raise CheapBuddyError(safe_error(exc.code, exc.headers.get("X-Request-ID", request_id))) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise CheapBuddyError("Could not download the video (%s). Request ID: %s" % (type(exc).__name__, request_id)) from None


def supports(model, capabilities):
    if not capabilities:
        return True
    available = model.get("capabilities", [])
    return isinstance(available, list) and any(cap in available for cap in capabilities)


def _task_id_from_payload(payload):
    if not isinstance(payload, dict):
        return ""
    for key in ("task_id", "native_task_id", "video_id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for key in ("data", "task", "response", "result"):
        task_id = _task_id_from_payload(payload.get(key))
        if task_id:
            return task_id
    return ""


def wait(seconds):
    time.sleep(max(0, seconds))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
