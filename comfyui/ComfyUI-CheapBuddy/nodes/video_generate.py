from ..cheapbuddy.errors import CheapBuddyError
from ..cheapbuddy.video_tasks import generate


class CheapBuddyVideoGenerate:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "base_url": ("STRING", {"default": "https://api.cheapbuddy.cc"}),
            "api_key": ("STRING", {"default": "", "password": True}),
            "model": ("STRING", {"default": "Select model"}),
            "operation": (["generate", "resume"],),
            "generation_type": (["text_to_video", "image_to_video", "reference_to_video"],),
            "prompt": ("STRING", {"multiline": True, "default": ""}),
            "task_id": ("STRING", {"default": ""}),
            "parameters_json": ("STRING", {"multiline": True, "default": "{}"}),
            "wait_seconds": ("INT", {"default": 900, "min": 0, "max": 1800}),
        }, "optional": {
            "first_frame": ("IMAGE",), "last_frame": ("IMAGE",), "reference_video": ("VIDEO",), "reference_audio": ("AUDIO",),
        }}

    RETURN_TYPES = ("VIDEO", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("video", "video_path", "video_url", "error", "task_id", "status")
    FUNCTION = "run"
    CATEGORY = "CheapBuddy"
    OUTPUT_NODE = True

    def run(self, base_url, api_key, model, operation, generation_type, prompt="", task_id="",
            parameters_json="{}", wait_seconds=900, first_frame=None, last_frame=None, reference_video=None, reference_audio=None):
        if operation == "resume" and (first_frame is not None or last_frame is not None or reference_video is not None or reference_audio is not None):
            raise CheapBuddyError("Disconnect media inputs in resume mode; only the task ID is used.")
        video_obj, video_url, video_path, error, result_task_id, status, filename = generate(
            base_url, api_key, model, operation, generation_type, prompt, task_id,
            parameters_json, first_frame, last_frame, reference_video, wait_seconds, reference_audio,
        )
        result = {"ui": {"videos": [{"filename": filename, "subfolder": "", "type": "output"}]}} if filename else {"ui": {}}
        if video_path:
            try:
                from comfy_api.latest import InputImpl
                video_obj = InputImpl.VideoFromFile(video_path)
            except Exception:
                raise CheapBuddyError("This ComfyUI build does not support the native VIDEO output required by CheapBuddy.") from None
        result["result"] = (video_obj or None, video_path, video_url, error, result_task_id, status)
        return result
