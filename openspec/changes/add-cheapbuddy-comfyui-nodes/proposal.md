# Proposal: CheapBuddy ComfyUI Nodes and Dynamic Model Discovery

**Change ID:** `add-cheapbuddy-comfyui-nodes`  
**Created:** 2026-09-26  
**Status:** Draft  
**Source design:** `comfyui/ComfyUI-CheapBuddy/TECHNICAL_DESIGN.md`

## Problem Statement

CheapBuddy exposes text, image, and video generation through a unified API, but ComfyUI users do not have native nodes for these capabilities. The current Relay model list aggregates model IDs but does not provide the complete capability and parameter metadata required to build model-aware node inputs. Users would otherwise need provider-specific nodes or manually construct API requests, duplicating gateway behavior and requiring plugin updates as models change.

## Proposed Solution

Add a standalone custom-node package under `comfyui/ComfyUI-CheapBuddy/` with three capability-oriented nodes: Text Generate, Image Generate, and Video Generate. Each node configures its own API Key and base URL, discovers compatible models from CheapBuddy, and builds requests from the selected model's capabilities and parameter schema.

Extend Relay model discovery to merge text metadata from Sub2API and media metadata from NewAPI, expose authenticated model detail lookup, and filter all metadata through CheapBuddy visibility and media publication/billing policy. Sub2API and NewAPI remain independently deployed upstream services and are not modified by this change.

The video node creates or resumes native CheapBuddy video tasks, polls and downloads completed results, and registers the resulting file using the supported ComfyUI native video output protocol. ComfyUI or its host platform owns output persistence and download delivery; Relay stores no media.

## Confirmed Decisions

- Exactly three CheapBuddy nodes ship in the initial scope.
- Text Generate also supports Vision through an optional image input when the selected model advertises the capability.
- Image Generate supports text-to-image, image edit, and image variation when advertised by the model.
- Video Generate supports text-to-video, image-to-video, and reference-to-video; its `generate`/`resume` operation avoids duplicate task creation.
- Each node contains its own editable `base_url` and API Key. The API Key is stored in workflow JSON by design.
- Model lists have a refresh action, schema-driven controls, and last-successful-cache fallback. No cache means a clear error rather than guessed capabilities.
- The video node saves and registers a standard ComfyUI output, emits task/result fields, and uses native ComfyUI `VIDEO`; minimum ComfyUI version is a release prerequisite.
- No standalone Config, Upload, Video Status / Result, or Save Video node is in scope.

## Scope

### In Scope

- Relay model metadata merge, authenticated single-model detail route, response normalization, and visibility/billing filtering.
- New ComfyUI package with exactly three nodes and a small frontend extension for model refresh and schema-driven inputs.
- Text, multimodal Vision, image generation/edit/variation, video generation and resume flows using existing native API routes.
- Direct multipart media submission; video polling, result download, native ComfyUI output registration, bounded timeouts, idempotency, and sanitized errors.
- Compatibility documentation and integration validation for local ComfyUI and hosted execution environments.

### Out of Scope

- Changes to Sub2API or NewAPI core; provider adapters or model-specific nodes.
- Persistent CheapBuddy file upload, CheapBuddy media storage, gallery, or CDN.
- Separate configuration, upload, task-status, or save nodes.
- Website UI changes, account management, or a new authentication system.
- Automatically installing optional video-node dependencies such as VideoHelperSuite.

## Impact Analysis

| Component | Change Required | Details |
|---|---|---|
| `relay/` | Yes | Add `/v1/models/{model_id}`, aggregate upstream metadata, preserve authorization and publication policy. |
| `comfyui/ComfyUI-CheapBuddy/` | Yes | Add package, three nodes, HTTP/model clients, schema UI extension, and documentation. |
| Sub2API | No | Existing deployment is the text metadata source. |
| NewAPI | No | Existing deployment is the media metadata and task source. |
| CheapBuddy website | No | The ComfyUI package is distributed independently. |
| ComfyUI runtime | Compatibility requirement | Use native `VIDEO` and saved-result preview APIs; pin a supported minimum version before release. |

## Architecture Considerations

- Relay remains a routing, identity, and policy boundary. It does not own provider schemas, media task state, billing formulas, or result storage.
- Text model metadata comes from Sub2API; media model metadata comes from NewAPI. Relay exposes one user-scoped normalized directory.
- The plugin uses only CheapBuddy's public API and does not call upstream services directly.
- ComfyUI workflow serialization stores each node's API Key, as explicitly accepted. Logs and error messages must still redact it; release guidance must warn against public workflow/result sharing without key removal.
- Hosted platforms must receive output through ComfyUI's standard result protocol. RunningHub output collection requires validation in its hosted environment; Comfy.icu is a node discovery/distribution surface, not a media store.
- Rich model-specific controls are limited to a documented schema subset. Unsupported/complex values use an advanced JSON input and are still validated by the backend.

## Success Criteria

- [ ] `GET /v1/models` returns authorized text and media models with capabilities and parameter metadata.
- [ ] Authenticated `GET /v1/models/{model_id}` returns normalized detail only for models visible to the caller.
- [ ] The ComfyUI package registers exactly three CheapBuddy node types and refreshes model/schema data without a plugin release.
- [ ] Each node can independently configure a CheapBuddy API Key and base URL; the key is not logged.
- [ ] Text/Vision, image generation/edit/variation, and video create/resume requests use the right native API route and schema fields.
- [ ] Video success appears as a native ComfyUI `VIDEO` output and a downloadable host task artifact; timeout preserves a resumable task ID without re-submission.
- [ ] Relay contract tests and local/hosted integration checks cover authorization, metadata merging, task behavior, and output collection.

## Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Relay model visibility differs from upstream metadata | Medium | High | Enforce CheapBuddy user, verified-model, and billing policy at both list and detail endpoints. |
| Upstream metadata formats drift | Medium | Medium | Normalize only documented fields, ignore unknown fields, and add contract fixtures. |
| API Key is shared with workflow JSON or embedded output metadata | High | High | This is accepted behavior; never log the key and document key rotation/removal before sharing workflows/results. |
| Hosted ComfyUI host does not collect custom video outputs | Medium | High | Use the native saved-result protocol and validate on RunningHub before claiming support. |
| Video generation times out while provider task continues | Medium | Medium | Return task ID and state, and support resume mode without a second create request. |
| ComfyUI versions differ in native video support | Medium | Medium | Set and test a minimum version before publishing. |
