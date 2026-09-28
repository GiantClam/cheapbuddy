# Delta: CheapBuddy ComfyUI Custom Nodes

**Change ID:** `add-cheapbuddy-comfyui-nodes`  
**Affects:** ComfyUI package, dynamic model controls, text/image/video workflows

## ADDED

### Requirement: Three capability-oriented CheapBuddy nodes

The package MUST register exactly three CheapBuddy nodes: Text Generate, Image Generate, and Video Generate. It MUST NOT add model-vendor-specific nodes or separate Config, Upload, Video Status / Result, or Save Video nodes. Each node MUST expose its own editable `base_url` (default `https://api.cheapbuddy.cc`) and API Key parameter. The API Key is intentionally persisted in the ComfyUI workflow as confirmed by the user, but MUST NOT appear in logs or error messages.

#### Scenario: Configure a node

- GIVEN a user adds any CheapBuddy node
- WHEN the user enters a base URL, API Key, model, and task parameters
- THEN the node executes using those values
- AND the API Key is sent only as a Bearer credential

### Requirement: Capability-driven model refresh and parameter controls

Each node MUST discover models from CheapBuddy's authenticated catalog, filter models by the selected node's capability, and offer a frontend refresh action. The plugin MUST cache successful model metadata for a bounded period and use its last successful cache when refresh fails. If no cache exists, it MUST show a clear error and MUST NOT guess capabilities from model IDs.

When a model is selected, common sockets MUST remain stable and the node MUST render documented schema-supported controls for common scalar/enum parameters. Complex or unknown parameters MUST be available through an advanced JSON field. The plugin MUST validate required fields and declared ranges before submission; the API remains authoritative.

#### Scenario: Newly published model

- GIVEN CheapBuddy publishes a visible model with capabilities and parameter schema
- WHEN the user refreshes models
- THEN the model and its supported operation/parameter controls become available without a plugin update or ComfyUI restart

#### Scenario: Metadata service unavailable

- GIVEN the metadata refresh fails and a previous successful catalog is cached
- WHEN a user opens or runs a node
- THEN the node uses the cached metadata and indicates that it is stale

### Requirement: Text and Vision generation

Text Generate MUST call `POST /v1/chat/completions` and return text output. It MUST support an optional ComfyUI IMAGE batch input. When an image is connected, the selected model MUST advertise Vision capability and the node MUST submit a multimodal request; otherwise the node MUST reject the incompatible request before submission.

#### Scenario: Text-only generation

- GIVEN a text-capable model and no image input
- WHEN the node executes
- THEN it submits a text chat completion and returns text

#### Scenario: Vision generation

- GIVEN a model advertising Vision and a connected IMAGE input
- WHEN the node executes
- THEN it submits the image and prompt using the documented multimodal message format

### Requirement: Image generation, edit, and variation

Image Generate MUST support `text_to_image`, `image_edit`, and `variation` only when the selected model advertises the corresponding capability. It MUST route operations to `/v1/images/generations`, `/v1/images/edits`, or `/v1/images/variations` respectively. Image and optional mask inputs MUST be sent using the documented multipart fields. Successful image results MUST be returned as ComfyUI IMAGE batches.

#### Scenario: Unsupported image operation

- GIVEN the selected model does not advertise the chosen image operation
- WHEN the user executes the node
- THEN the node rejects the operation with a clear capability error
- AND it does not submit a billable request

### Requirement: Video generation and task resumption

Video Generate MUST support `text_to_video`, `image_to_video`, and `reference_to_video` when advertised by the selected model. Generation MUST submit to `POST /v1/videos`; local image/video/audio references MUST be attached as request-scoped multipart data and MUST NOT require a persistent remote file API.

The node MUST support `generate` and `resume` actions. `resume` MUST require a task ID and MUST only query/download the existing task. The plugin MUST NOT automatically retry a generation POST. It MUST poll the native status endpoint using bounded backoff, download successful results from the public content route, and return task ID/status if the configured wait limit expires.

#### Scenario: Resume after wait timeout

- GIVEN a generation task remains in progress after the node's wait limit
- WHEN the node returns
- THEN it returns the existing task ID and current status without a video path
- AND a later `resume` action can retrieve that task without creating another task

### Requirement: Native ComfyUI video output

Video Generate MUST save successful video content under the active ComfyUI instance's configured output directory, return native VIDEO data, and register a standard saved-result preview so supported host platforms can collect the artifact. It MUST NOT hard-code a machine-specific output path or require VideoHelperSuite. The package MUST declare and validate the minimum ComfyUI version required by the native VIDEO and preview protocol.

#### Scenario: Hosted output collection

- GIVEN a host runs the workflow and supports the standard ComfyUI saved-result protocol
- WHEN the video node completes successfully
- THEN the host can identify and return the saved video as a task artifact
- AND the node exposes task ID, status, result URL, and local path outputs as available

### Requirement: Bounded media download and redacted diagnostics

The plugin MUST bound request/response size, timeout, redirect count, and media download size. It MUST validate result MIME and image dimensions, reject unsafe URL destinations, use safe generated filenames, and clean incomplete temporary files. It MUST log request IDs and non-sensitive diagnostics only; API Keys, prompts, media bytes, and full response bodies MUST NOT be logged.

#### Scenario: Unsafe or oversized result

- GIVEN a media result URL redirects to a private address or exceeds the configured download limit
- WHEN the plugin retrieves the result
- THEN it rejects the result safely without writing an unbounded or unsafe file
