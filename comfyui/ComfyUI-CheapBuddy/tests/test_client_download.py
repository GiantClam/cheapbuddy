import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from io import BytesIO

from cheapbuddy.client import Client
from cheapbuddy.errors import CheapBuddyError


class EndlessResponse:
    headers = {"Content-Type": "video/mp4"}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _size):
        return b"x"


class TrickleResponse(EndlessResponse):
    def read(self, _size):
        raise AssertionError("bulk read waits for a full block")

    def read1(self, _size):
        return b"x"


class DownloadTimeoutTests(unittest.TestCase):
    def test_download_enforces_total_deadline_during_trickle(self):
        client = Client("https://api.cheapbuddy.cc", "test-key")
        opener = type("Opener", (), {"open": lambda _self, *_args, **_kwargs: EndlessResponse()})()
        with patch("cheapbuddy.client.urllib.request.build_opener", return_value=opener), \
                patch("cheapbuddy.client.time.monotonic", side_effect=[100, 101, 103]):
            with self.assertRaisesRegex(CheapBuddyError, "Could not download"):
                client.download("/v1/videos/task-1/content", timeout=2)

    def test_download_reads_available_chunks(self):
        client = Client("https://api.cheapbuddy.cc", "test-key")
        opener = type("Opener", (), {"open": lambda _self, *_args, **_kwargs: TrickleResponse()})()
        with patch("cheapbuddy.client.urllib.request.build_opener", return_value=opener), \
                patch("cheapbuddy.client.time.monotonic", side_effect=[100, 101, 103]):
            with self.assertRaisesRegex(CheapBuddyError, "Could not download"):
                client.download("/v1/videos/task-1/content", timeout=2)


class VideoCreateReplayTests(unittest.TestCase):
    def test_upload_media_posts_raw_media_and_returns_url(self):
        client = Client("https://api.cheapbuddy.cc", "test-key")
        with patch.object(client, "request", return_value={"url": "https://api.cheapbuddy.cc/v1/media/token"}) as request:
            self.assertEqual(client.upload_media(b"png", "image/png"), "https://api.cheapbuddy.cc/v1/media/token")
        request.assert_called_once_with("POST", "/v1/media", b"png", content_type="image/png", timeout=180)

    def test_create_video_uses_task_id_from_idempotency_conflict(self):
        client = Client("https://api.cheapbuddy.cc", "test-key")
        error = HTTPError(
            "https://api.cheapbuddy.cc/v1/videos",
            409,
            "Conflict",
            {"X-Request-ID": "request-1"},
            BytesIO(b'{"error":{"type":"idempotency_conflict"},"task_id":"task-accepted"}'),
        )
        with patch("cheapbuddy.client.urllib.request.build_opener") as build_opener:
            opener = build_opener.return_value
            opener.open.side_effect = error
            self.assertEqual(client.create_video({"model": "video-model"}), {
                "id": "task-accepted",
                "task_id": "task-accepted",
                "status": "in_progress",
            })

    def test_create_video_replays_with_same_key_after_disconnect(self):
        client = Client("https://api.cheapbuddy.cc", "test-key")
        payload = b"video request"
        with patch.object(client, "request", side_effect=[
            CheapBuddyError("Could not reach CheapBuddy (RemoteDisconnected)."),
            CheapBuddyError("CheapBuddy request failed (HTTP 409)."),
            {"id": "task-1"},
        ]) as request, patch("cheapbuddy.client.time.sleep"):
            self.assertEqual(client.create_video(payload, "multipart/form-data; boundary=x"), {"id": "task-1"})

        self.assertEqual(request.call_count, 3)
        keys = [call.kwargs["extra_headers"]["Idempotency-Key"] for call in request.call_args_list]
        self.assertEqual(len(set(keys)), 1)
        self.assertTrue(all(call.args[2] is payload for call in request.call_args_list))

    def test_create_video_does_not_replay_provider_failure(self):
        client = Client("https://api.cheapbuddy.cc", "test-key")
        with patch.object(client, "request", side_effect=CheapBuddyError("CheapBuddy request failed (HTTP 503).")) as request:
            with self.assertRaises(CheapBuddyError):
                client.create_video({"model": "video-model"})
        self.assertEqual(request.call_count, 1)

