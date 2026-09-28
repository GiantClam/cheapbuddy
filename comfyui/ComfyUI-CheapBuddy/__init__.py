"""CheapBuddy nodes for ComfyUI."""

from .nodes.text_generate import CheapBuddyTextGenerate
from .nodes.image_generate import CheapBuddyImageGenerate
from .nodes.video_generate import CheapBuddyVideoGenerate

NODE_CLASS_MAPPINGS = {
    "CheapBuddyTextGenerate": CheapBuddyTextGenerate,
    "CheapBuddyImageGenerate": CheapBuddyImageGenerate,
    "CheapBuddyVideoGenerate": CheapBuddyVideoGenerate,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheapBuddyTextGenerate": "CheapBuddy Text Generate",
    "CheapBuddyImageGenerate": "CheapBuddy Image Generate",
    "CheapBuddyVideoGenerate": "CheapBuddy Video Generate",
}

WEB_DIRECTORY = "./web"

try:
    from .server import register_routes
except ImportError:
    # Importing this package outside ComfyUI is useful for node inspection.
    pass
else:
    register_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
