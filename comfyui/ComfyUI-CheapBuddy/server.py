"""Local ComfyUI routes used by the refresh-models button."""

import logging
from urllib.parse import urlsplit

from .cheapbuddy.client import Client
from .cheapbuddy.errors import CheapBuddyError
from .cheapbuddy.model_filter import supports_node as _matches

logger = logging.getLogger("CheapBuddy")


def register_routes():
    from server import PromptServer
    from aiohttp import web

    routes = PromptServer.instance.routes

    @routes.post("/cheapbuddy/models")
    async def models(request):
        body = await request.json()
        try:
            client = Client(body.get("base_url", ""), body.get("api_key", ""), timeout=20)
            kind = body.get("kind", "")
            if kind not in ("text", "image", "video"):
                raise CheapBuddyError("Unknown CheapBuddy node category.")
            host = urlsplit(client.base_url).hostname or "invalid"
            logger.info("Model discovery started (kind=%s host=%s)", kind, host)
            rows = client.models()
            logger.info(
                "Model catalog metadata (kind=%s rows=%s)",
                kind,
                [
                    {
                        "id": row.get("id"),
                        "type": row.get("type"),
                        "capabilities": row.get("capabilities"),
                        "supported_endpoint_types": row.get("supported_endpoint_types"),
                    }
                    for row in rows
                ],
            )
            models = [model for model in rows if _matches(model, kind)]
            logger.info("Model discovery completed (kind=%s count=%d)", kind, len(models))
            return web.json_response({"data": models})
        except CheapBuddyError as exc:
            logger.warning("Model discovery failed (kind=%s): %s", body.get("kind", "unknown"), exc)
            return web.json_response({"error": str(exc)}, status=400)

    @routes.post("/cheapbuddy/model")
    async def model_detail(request):
        body = await request.json()
        try:
            client = Client(body.get("base_url", ""), body.get("api_key", ""), timeout=20)
            return web.json_response(client.model(str(body.get("model", ""))))
        except CheapBuddyError as exc:
            return web.json_response({"error": str(exc)}, status=400)
