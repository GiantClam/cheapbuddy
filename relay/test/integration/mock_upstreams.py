import json
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


state = {"billing": [], "users": {}, "next_native_request_id": 1, "native_logs": {}}
lock = threading.Lock()


def response(handler, status, payload, headers=None):
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(body)


class MockHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def service_authorized(self):
        return self.headers.get("Authorization") == "Bearer relay-bridge"

    def api_key_authorized(self):
        return self.headers.get("Authorization") in {"Bearer test-key", "Bearer shadow-token"}

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/test/billing":
            with lock:
                operations = list(state["billing"])
            return response(self, HTTPStatus.OK, {"operations": operations})
        if parsed.path == "/v1/models":
            if not self.api_key_authorized():
                return response(self, HTTPStatus.UNAUTHORIZED, {"error": "invalid key"})
            return response(self, HTTPStatus.OK, {"object": "list", "data": [{"id": "text-model", "object": "model"}]}, {"Set-Cookie": "upstream=session"})
        if parsed.path.startswith("/api/token/"):
            return response(self, HTTPStatus.OK, {"data": {"items": [{"id": 601, "name": "cheapbuddy_101-media"}]}})
        if parsed.path == "/api/log/":
            native_request_id = parse_qs(parsed.query).get("request_id", [""])[0]
            with lock:
                log = state["native_logs"].get(native_request_id)
            return response(self, HTTPStatus.OK, {"success": True, "data": {"items": [log] if log else []}})
        return response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self):
        payload = self.body()
        if self.path == "/api/internal/cheapbuddy/identity":
            if not self.service_authorized() or payload.get("api_key") != "test-key":
                return response(self, HTTPStatus.UNAUTHORIZED, {"error": "invalid bridge request"})
            return response(self, HTTPStatus.OK, {"user_id": 101, "api_key_id": 201})
        if self.path.startswith("/api/internal/cheapbuddy/billing/"):
            if not self.service_authorized():
                return response(self, HTTPStatus.UNAUTHORIZED, {"error": "invalid bridge request"})
            operation = self.path.rsplit("/", 1)[-1]
            request = payload
            with lock:
                state["billing"].append({"operation": operation, "request_id": request.get("request_id")})
            return response(self, HTTPStatus.OK, {"billing_request_id": f"mock-{operation}-{request.get('request_id')}"})
        if self.path == "/v1/chat/completions":
            if not self.api_key_authorized():
                return response(self, HTTPStatus.UNAUTHORIZED, {"error": "invalid key"})
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Set-Cookie", "upstream=session")
            self.end_headers()
            self.wfile.write(b"data: first\n\n")
            self.wfile.flush()
            time.sleep(0.5)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return
        if self.path == "/api/user/":
            user = payload
            with lock:
                state["users"][user.get("username")] = user
            return response(self, HTTPStatus.OK, {"data": {"id": 501}})
        if self.path == "/api/user/manage":
            if not self.service_authorized() and self.headers.get("Authorization") != "Bearer mock-newapi-admin":
                return response(self, HTTPStatus.UNAUTHORIZED, {"error": "invalid admin key"})
            return response(self, HTTPStatus.OK, {"success": True, "message": ""})
        if self.path == "/api/user/login":
            return response(self, HTTPStatus.OK, {"data": {"token": "shadow-session"}})
        if self.path == "/api/token/":
            return response(self, HTTPStatus.OK, {"data": {"id": 601}})
        if self.path == "/api/token/601/key":
            return response(self, HTTPStatus.OK, {"data": {"key": "shadow-token"}})
        if self.path == "/v1/images/generations":
            with lock:
                sequence = state["next_native_request_id"]
                state["next_native_request_id"] += 1
                native_request_id = f"native-image-{sequence}"
                state["native_logs"][native_request_id] = {"id": sequence, "request_id": native_request_id, "quota": 100}
            return response(self, HTTPStatus.OK, {"data": [{"url": "https://example.invalid/generated.png"}]}, {"X-Oneapi-Request-Id": native_request_id, "Set-Cookie": "upstream=session"})
        if self.path == "/v1/videos":
            with lock:
                sequence = state["next_native_request_id"]
                state["next_native_request_id"] += 1
                native_request_id = f"native-video-{sequence}"
                state["native_logs"][native_request_id] = {"id": sequence, "request_id": native_request_id, "quota": 1000}
            return response(self, HTTPStatus.OK, {"id": f"native-video-task-{sequence}", "status": "queued"}, {"X-Oneapi-Request-Id": native_request_id})
        return response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})


ThreadingHTTPServer(("0.0.0.0", 8081), MockHandler).serve_forever()
