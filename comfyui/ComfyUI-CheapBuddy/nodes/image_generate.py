import json

from ..cheapbuddy.client import Client
from ..cheapbuddy.errors import CheapBuddyError
from ..cheapbuddy.images import decode_result, multipart, stack_images, tensor_images, tensor_masks
from ..cheapbuddy.models import parameters_json


class CheapBuddyImageGenerate:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "base_url": ("STRING", {"default": "https://api.cheapbuddy.cc"}),
            "api_key": ("STRING", {"default": "", "password": True}),
            "model": ("STRING", {"default": "Select model"}),
            "operation": (["text_to_image", "image_edit", "variation"],),
            "prompt": ("STRING", {"multiline": True, "default": ""}),
            "parameters_json": ("STRING", {"multiline": True, "default": "{}"}),
        }, "optional": {"image": ("IMAGE",), "mask": ("MASK",)}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "result_info")
    FUNCTION = "generate"
    CATEGORY = "CheapBuddy"

    def generate(self, base_url, api_key, model, operation, prompt="", parameters_json="{}", image=None, mask=None):
        client = Client(base_url, api_key)
        detail = client.model(model)
        required_capability = operation
        if required_capability not in detail.get("capabilities", []):
            raise CheapBuddyError("Selected model does not advertise %s." % operation)
        extra = parameters_json_fn(parameters_json, detail)
        images = tensor_images(image)
        masks = tensor_masks(mask)
        if masks and operation != "image_edit":
            raise CheapBuddyError("MASK input is only supported for image_edit.")
        if operation != "text_to_image" and not images:
            raise CheapBuddyError("This operation requires an IMAGE input.")
        if operation == "text_to_image" and images:
            raise CheapBuddyError("Disconnect IMAGE for text_to_image, or select an image operation.")
        payload = {"model": model, "prompt": prompt, **extra}
        if operation == "text_to_image":
            response = client.json("POST", "/v1/images/generations", payload)
        else:
            route = "/v1/images/edits" if operation == "image_edit" else "/v1/images/variations"
            files = [("image[]", "input-%d.png" % index, value, "image/png") for index, value in enumerate(images)]
            if masks:
                files.append(("mask", "mask.png", masks[0], "image/png"))
            body, content_type = multipart(payload, files)
            response = client.request("POST", route, body, content_type=content_type)
        rows = response.get("data", []) if isinstance(response, dict) else []
        if not rows:
            raise CheapBuddyError("Image response did not contain any images.")
        tensors = [decode_result(item) for item in rows]
        result = stack_images(tensors)
        info = {key: value for key, value in response.items() if key != "data"}
        return result, json.dumps(info, ensure_ascii=False)


def parameters_json_fn(raw, detail):
    return parameters_json(raw, detail)
