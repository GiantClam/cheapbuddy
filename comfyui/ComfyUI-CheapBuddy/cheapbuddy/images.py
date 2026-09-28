import base64
import io
import ipaddress
import socket
import urllib.error
import urllib.request

import numpy as np
import torch
from PIL import Image

from .errors import CheapBuddyError

MAX_IMAGE_BYTES = 40 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000


def tensor_images(images):
    if images is None:
        return []
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise CheapBuddyError("IMAGE input must be a ComfyUI image batch.")
    result = []
    for tensor in images:
        array = (tensor.detach().cpu().numpy().clip(0, 1) * 255).round().astype(np.uint8)
        image = Image.fromarray(array)
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise CheapBuddyError("Input image exceeds the pixel limit.")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        result.append(buffer.getvalue())
    return result


def tensor_masks(masks):
    if masks is None:
        return []
    if not isinstance(masks, torch.Tensor):
        raise CheapBuddyError("MASK input must be a ComfyUI mask batch.")
    values = masks.detach().cpu()
    if values.ndim == 2:
        values = values.unsqueeze(0)
    if values.ndim == 4 and values.shape[-1] == 1:
        values = values[..., 0]
    if values.ndim != 3:
        raise CheapBuddyError("MASK input must have batch, height and width dimensions.")
    result = []
    for tensor in values:
        array = (tensor.numpy().clip(0, 1) * 255).round().astype(np.uint8)
        image = Image.fromarray(array, mode="L")
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise CheapBuddyError("Input mask exceeds the pixel limit.")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        result.append(buffer.getvalue())
    return result


def to_data_url(png_bytes):
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def decode_result(item):
    if isinstance(item, dict) and item.get("b64_json"):
        try:
            raw = base64.b64decode(item["b64_json"], validate=True)
        except (ValueError, TypeError):
            raise CheapBuddyError("Image response contained invalid base64 data.") from None
        return load_image_bytes(raw)
    if isinstance(item, dict) and isinstance(item.get("url"), str):
        return load_image_bytes(download_result(item["url"]))
    raise CheapBuddyError("Image response contained no supported image data.")


def stack_images(tensors):
    if not tensors:
        raise CheapBuddyError("Image response did not contain any images.")
    height = max(tensor.shape[1] for tensor in tensors)
    width = max(tensor.shape[2] for tensor in tensors)
    channels = tensors[0].shape[3]
    if all(tensor.shape[1:] == (height, width, channels) for tensor in tensors):
        return torch.cat(tensors, dim=0)
    result = torch.zeros((len(tensors), height, width, channels), dtype=tensors[0].dtype)
    for index, tensor in enumerate(tensors):
        if tensor.ndim != 4 or tensor.shape[0] != 1 or tensor.shape[3] != channels:
            raise CheapBuddyError("Image response contained incompatible image shapes.")
        result[index, :tensor.shape[1], :tensor.shape[2], :] = tensor[0]
    return result


def load_image_bytes(raw):
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise CheapBuddyError("Image response exceeded the size limit.")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise CheapBuddyError("Image response exceeded the pixel limit.")
            rgb = image.convert("RGB")
            array = np.asarray(rgb, dtype=np.float32) / 255.0
            return torch.from_numpy(array.copy()).unsqueeze(0)
    except CheapBuddyError:
        raise
    except Exception:
        raise CheapBuddyError("CheapBuddy returned an invalid image.") from None


def download_result(url):
    current = url
    for _ in range(4):
        previous = current
        _check_public_url(current)
        req = urllib.request.Request(current, headers={"User-Agent": "ComfyUI-CheapBuddy/0.1.0"})
        opener = urllib.request.build_opener(_NoRedirect())
        try:
            with opener.open(req, timeout=45) as response:
                content_type = response.headers.get_content_type()
                if not content_type.startswith("image/"):
                    raise CheapBuddyError("Image result URL did not return an image MIME type.")
                data = response.read(MAX_IMAGE_BYTES + 1)
                if len(data) > MAX_IMAGE_BYTES:
                    raise CheapBuddyError("Image result exceeded the size limit.")
                return data
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                current = exc.headers.get("Location", "")
                if not current:
                    break
                from urllib.parse import urljoin
                current = urljoin(previous, current)
                continue
            raise CheapBuddyError("Could not download the image result (HTTP %s)." % exc.code) from None
        except (urllib.error.URLError, OSError):
            raise CheapBuddyError("Could not download the image result.") from None
    raise CheapBuddyError("Image result redirected too many times.")


def _check_public_url(url):
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise CheapBuddyError("Image result URL must use HTTPS without embedded credentials.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise CheapBuddyError("Image result URL resolved to a non-public address.")
    except (socket.gaierror, ValueError):
        raise CheapBuddyError("Could not validate image result URL.") from None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def multipart(fields, files):
    import secrets
    boundary = "----CheapBuddy" + secrets.token_hex(16)
    chunks = []
    for name, value in fields.items():
        chunks.extend([("--" + boundary + "\r\n").encode(),
                       ('Content-Disposition: form-data; name="%s"\r\n\r\n' % name).encode(),
                       _field_bytes(value), b"\r\n"])
    for name, filename, content, mime in files:
        chunks.extend([("--" + boundary + "\r\n").encode(),
                       ('Content-Disposition: form-data; name="%s"; filename="%s"\r\n' % (name, filename)).encode(),
                       ("Content-Type: %s\r\n\r\n" % mime).encode(), content, b"\r\n"])
    chunks.append(("--" + boundary + "--\r\n").encode())
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


def _field_bytes(value):
    if isinstance(value, bool):
        return ("true" if value else "false").encode("ascii")
    if isinstance(value, (dict, list)):
        import json
        return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return str(value).encode("utf-8")
