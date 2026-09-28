def supports_node(model, kind):
    capabilities = model.get("capabilities", [])
    if not isinstance(capabilities, list):
        capabilities = []
    supported_endpoints = model.get("supported_endpoint_types", [])
    if not isinstance(supported_endpoints, list):
        supported_endpoints = []
    model_type = str(model.get("type", "")).strip().lower()
    supported_types = {
        "text": {"text", "language", "llm", "vision", "chat", "chat.completion"},
        "image": {"image", "image_generation"},
        "video": {"video", "video_generation"},
    }.get(kind)
    supported_capabilities = {
        "text": {"text_generation", "vision"},
        "image": {"text_to_image", "image_edit", "variation"},
        "video": {"text_to_video", "image_to_video", "reference_to_video"},
    }.get(kind)
    supported_endpoints_by_kind = {
        "text": set(),
        "image": {"image-generation"},
        "video": {"openai-video"},
    }.get(kind)
    if supported_types is None or supported_capabilities is None or supported_endpoints_by_kind is None:
        return False
    matches = (
        model_type in supported_types
        or any(cap in supported_capabilities for cap in capabilities)
        or any(endpoint in supported_endpoints_by_kind for endpoint in supported_endpoints)
    )
    if kind == "text":
        # A generic OpenAI-compatible catalog object is not evidence that the
        # model supports text generation; Relay must provide an explicit type
        # or capability before exposing it in the text node.
        if model_type == "model" and not any(cap in {"text_generation", "vision"} for cap in capabilities):
            return False
        media_only_classification = (
            model_type in {"image", "image_generation", "video", "video_generation"}
            or any(cap in {"text_to_image", "image_edit", "variation", "text_to_video", "image_to_video", "reference_to_video"} for cap in capabilities)
            or any(endpoint in {"image-generation", "openai-video"} for endpoint in supported_endpoints)
        )
        explicit_text_capability = any(cap in {"text_generation", "vision"} for cap in capabilities)
        if media_only_classification and not explicit_text_capability:
            return False
    # Trust only the fields present in CheapBuddy's live catalog. Type lets a
    # modality node discover the model; per-operation capabilities are loaded
    # from its detail endpoint and enforced before generation.
    return matches
