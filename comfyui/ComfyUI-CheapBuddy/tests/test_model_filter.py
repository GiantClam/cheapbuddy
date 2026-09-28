import unittest

from cheapbuddy.model_filter import supports_node as _matches


class ModelCapabilityFilterTests(unittest.TestCase):
    def test_unclassified_models_are_not_exposed_to_any_node(self):
        model = {"id": "unknown-model", "object": "model", "owned_by": "upstream"}

        for kind in ("text", "image", "video"):
            with self.subTest(kind=kind):
                self.assertFalse(_matches(model, kind))

    def test_generic_openai_catalog_entry_is_not_exposed_as_text(self):
        model = {
            "id": "grok-imagine-image-2.0",
            "type": "image",
            "capabilities": ["text_to_image"],
            "supported_endpoint_types": ["openai"],
        }

        self.assertFalse(_matches(model, "text"))
        self.assertTrue(_matches(model, "image"))
        self.assertFalse(_matches({"type": "model", "supported_endpoint_types": ["openai"]}, "text"))
        self.assertFalse(_matches({"id": "grok-imagine-image-2.0", "supported_endpoint_types": ["openai"]}, "text"))

    def test_explicit_type_from_catalog_exposes_only_its_modality(self):
        model = {"id": "image-model", "type": "image_generation"}

        self.assertTrue(_matches(model, "image"))
        self.assertFalse(_matches(model, "text"))
        self.assertFalse(_matches(model, "video"))

    def test_each_node_only_accepts_its_declared_capabilities(self):
        cases = {
            "text": {"text_generation": True, "vision": True, "text_to_image": False},
            "image": {"text_to_image": True, "image_edit": True, "text_generation": False},
            "video": {"text_to_video": True, "image_to_video": True, "text_to_image": False},
        }

        for kind, capabilities in cases.items():
            for capability, expected in capabilities.items():
                with self.subTest(kind=kind, capability=capability):
                    self.assertEqual(
                        _matches({"id": "model", "capabilities": [capability]}, kind),
                        expected,
                    )

    def test_newapi_supported_endpoint_types_expose_their_modality(self):
        image_model = {"id": "image-model", "supported_endpoint_types": ["image-generation"]}
        video_model = {"id": "video-model", "supported_endpoint_types": ["openai-video"]}

        self.assertTrue(_matches(image_model, "image"))
        self.assertFalse(_matches(image_model, "video"))
        self.assertTrue(_matches(video_model, "video"))
        self.assertFalse(_matches(video_model, "image"))

    def test_malformed_capabilities_and_unknown_node_kind_are_rejected(self):
        self.assertFalse(_matches({"capabilities": "text_generation"}, "text"))
        self.assertFalse(_matches({"capabilities": ["text_generation"]}, "audio"))

    def test_multimodal_model_is_visible_in_text_and_video_nodes(self):
        model = {
            "id": "multimodal-model",
            "type": "text",
            "capabilities": ["text_generation", "text_to_video"],
            "supported_endpoint_types": ["openai", "openai-video"],
        }

        self.assertTrue(_matches(model, "text"))
        self.assertTrue(_matches(model, "video"))

    def test_media_model_with_legacy_text_type_is_not_shown_as_text(self):
        models = [
            {
                "id": "video-model",
                "type": "text",
                "capabilities": ["text_to_video", "image_to_video"],
                "supported_endpoint_types": ["openai-video", "openai"],
            },
            {
                "id": "image-model",
                "type": "image",
                "capabilities": ["text_to_image"],
                "supported_endpoint_types": ["image-generation", "openai"],
            },
        ]

        for model in models:
            with self.subTest(model=model["id"]):
                self.assertFalse(_matches(model, "text"))
                self.assertTrue(_matches(model, "video" if model["id"] == "video-model" else "image"))


if __name__ == "__main__":
    unittest.main()
