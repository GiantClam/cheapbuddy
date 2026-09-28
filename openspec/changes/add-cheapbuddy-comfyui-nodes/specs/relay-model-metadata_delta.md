# Delta: Relay Model Metadata Aggregation

**Change ID:** `add-cheapbuddy-comfyui-nodes`  
**Affects:** Public model list, model detail route, model visibility policy

## ADDED

### Requirement: User-scoped unified model catalog

Relay MUST expose `GET /v1/models` as a unified catalog using the authenticated CheapBuddy user's upstream identity. Text model metadata MUST come from Sub2API; media model metadata MUST come from NewAPI. Relay MUST preserve the OpenAI-compatible base model fields and normalize the documented `type`, `capabilities`, and `parameter_schema` extensions.

#### Scenario: Merge text and media models

- GIVEN an authenticated CheapBuddy user with visible text models from Sub2API and visible media models from NewAPI
- WHEN the user requests `GET /v1/models`
- THEN Relay returns the union of those models in one response
- AND each model retains its owning upstream's capability and parameter metadata
- AND duplicate IDs are resolved using an explicit ownership rule

#### Scenario: Hide unavailable media model

- GIVEN a NewAPI media model is not verified, not visible to the CheapBuddy user, or missing required billing configuration
- WHEN the user requests `GET /v1/models`
- THEN Relay omits that model from the response
- AND Relay does not make the model callable by exposing metadata alone

### Requirement: Authenticated model detail lookup

Relay MUST allow authenticated `GET /v1/models/{model_id}` and return normalized detail for a model visible and callable by the user. Relay MUST use the proper upstream source for the model owner, validate/encode the model identifier as one path segment, and return a non-enumerating not-found response for missing or unauthorized models.

#### Scenario: Read visible model detail

- GIVEN a user is authorized to call a model
- WHEN the user requests its detail by model ID
- THEN Relay returns its type, capabilities, and parameter schema from the owning upstream
- AND no upstream credential or internal endpoint is exposed

#### Scenario: Request unauthorized model detail

- GIVEN a model exists upstream but is not available to the CheapBuddy user or fails media publication policy
- WHEN the user requests its detail
- THEN Relay returns a non-enumerating not-found response

### Requirement: Upstream failure and metadata compatibility

Relay MUST bound upstream model metadata response sizes and timeouts. It MUST ignore unknown metadata fields while preserving the documented schema fields. It MUST NOT infer model capabilities from model IDs. If an upstream needed for the result is unavailable, Relay MUST return a safe service error rather than claiming an incomplete model is fully discoverable.

#### Scenario: Unknown metadata extension

- GIVEN an upstream model item has additional fields not recognized by Relay
- WHEN Relay normalizes the item
- THEN it preserves compatible base fields and documented metadata
- AND safely ignores unknown fields without failing the whole catalog

