import json

from ..cheapbuddy.client import Client
from ..cheapbuddy.errors import CheapBuddyError
from ..cheapbuddy.images import tensor_images, to_data_url


class CheapBuddyTextGenerate:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "base_url": ("STRING", {"default": "https://api.cheapbuddy.cc"}),
            "api_key": ("STRING", {"default": "", "password": True}),
            "model": ("STRING", {"default": "Select model"}),
            "prompt": ("STRING", {"multiline": True, "default": ""}),
            "system_prompt": ("STRING", {"multiline": True, "default": ""}),
            "temperature": ("FLOAT", {"default": 0.7, "min": 0, "max": 2, "step": 0.05}),
            "max_tokens": ("INT", {"default": 1024, "min": 1, "max": 32768}),
            "parameters_json": ("STRING", {"multiline": True, "default": "{}"}),
        }, "optional": {"image": ("IMAGE",)}}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text", "raw_json")
    FUNCTION = "generate"
    CATEGORY = "CheapBuddy"

    def generate(self, base_url, api_key, model, prompt, system_prompt="", temperature=0.7, max_tokens=1024, parameters_json="{}", image=None):
        client = Client(base_url, api_key)
        detail = client.model(model)
        caps = detail.get("capabilities", [])
        content = prompt
        image_batch = tensor_images(image)
        if image_batch:
            if "vision" not in caps:
                raise CheapBuddyError("Selected model does not advertise Vision capability.")
            content = [{"type": "text", "text": prompt}]
            content.extend({"type": "image_url", "image_url": {"url": to_data_url(item)}} for item in image_batch)
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": content})
        payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        from ..cheapbuddy.models import parameters_json as parse_parameters
        payload.update(parse_parameters(parameters_json, detail))
        response = client.json("POST", "/v1/chat/completions", payload)
        try:
            text = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise CheapBuddyError("Text response did not contain a completion.") from None
        if isinstance(text, list):
            text = "\n".join(part.get("text", "") for part in text if isinstance(part, dict))
        return str(text), json.dumps(response, ensure_ascii=False)
