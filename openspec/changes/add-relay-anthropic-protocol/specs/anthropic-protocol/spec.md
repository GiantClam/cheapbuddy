# Anthropic Protocol Delta

The requirements below are normative after the user confirmation recorded in the proposal. Relay implementation is limited to the HTTP boundary; Sub2API remains authoritative for native and compatible business semantics.

## ADDED Requirements

### Requirement: Anthropic protocol support at the public Relay

The Relay SHALL support the Anthropic model-inference protocol for authorized Claude requests, rather than treating model-name admission or header acceptance alone as proof of protocol compatibility. The concrete client compatibility contract and feature matrix SHALL be confirmed before implementation.

#### Scenario: Native Claude request follows the text gateway boundary

- **GIVEN** a valid existing CheapBuddy API Key whose user is authorized to use the Claude service and an admitted Claude model
- **WHEN** the client submits a request within the confirmed Anthropic protocol contract
- **THEN** the request is handled through the Sub2API text gateway and returns the confirmed Anthropic response semantics
- **AND** the request is not routed through NewAPI media reservation or settlement

### Requirement: Unchanged CheapBuddy endpoint and API Key

The Relay SHALL allow authorized Claude requests using the user's existing CheapBuddy Base URL and existing CheapBuddy API Key. It SHALL NOT require users to change the CheapBuddy endpoint, rotate the Key or create a separate Claude-only Key solely to use the Anthropic protocol. Any internal route or group selection SHALL remain server-side and preserve explicit model permissions, quotas, expiry and account status controls.

#### Scenario: Existing Key accesses an authorized Claude model

- **GIVEN** a user with a valid existing CheapBuddy API Key and permission to use a supported Claude model
- **WHEN** the user invokes that model using the confirmed Anthropic protocol and the same existing CheapBuddy Base URL and Key
- **THEN** the gateway resolves the authorized Claude text route without requiring a separate client credential
- **AND** existing customer price policies and wallet checks remain authoritative

#### Scenario: Explicit restrictions remain effective with unified credentials

- **GIVEN** an existing Key with an explicit model restriction, exhausted quota, expired validity or disabled status
- **WHEN** a Claude request uses the unchanged Base URL and Key
- **THEN** protocol compatibility does not bypass that restriction

### Requirement: First release Anthropic inference endpoints

The Relay SHALL support POST /v1/messages for non-streaming responses and SSE streaming, POST /v1/messages/count_tokens, GET /v1/models, and GET /v1/models/{model_id} within the approved user authorization boundary and without changing existing CheapBuddy client Base URLs or API Keys. Anthropic Batch, Files and Admin platform APIs SHALL remain outside this first-release scope. Business payload, discovery-envelope and upstream failure contracts are provided by Sub2API, not a new Relay protocol implementation; unresolved HTTP boundary and user-access policies remain subject to the interview decisions.

#### Scenario: Messages supports non-streaming and SSE requests

- **GIVEN** an existing authorized CheapBuddy Key and a supported Claude model
- **WHEN** the client invokes POST /v1/messages with streaming disabled or enabled
- **THEN** the gateway provides the corresponding confirmed Anthropic JSON response or SSE contract
- **AND** the client does not need a separate Key or endpoint to select the response mode

#### Scenario: Counting and discovery use the same credentials

- **GIVEN** the same authorized CheapBuddy Base URL and Key used for inference
- **WHEN** the client calls token counting, model listing or a single-model detail endpoint
- **THEN** the approved corresponding endpoint is available under the confirmed Anthropic contract
- **AND** model permissions and other applicable access controls remain enforced

#### Scenario: Platform API expansion is not implied

- **GIVEN** the first-release Anthropic inference support
- **WHEN** a client requests an Anthropic Batch, Files or Admin platform API
- **THEN** that platform API is not advertised or introduced as part of this change

### Requirement: Sub2API is the native protocol authority

For the approved Anthropic endpoints, the Relay SHALL transparently forward the native business request and response contracts provided by the deployed Sub2API service. It SHALL NOT independently interpret, validate or rewrite Anthropic content blocks, Tools, Vision, Thinking signatures, cache control, upstream error payloads or SSE event semantics. Approved HTTP path admission, authentication-header access, endpoint normalization and necessary transport-security handling remain Relay boundary responsibilities.

#### Scenario: Rich and unknown request fields pass through unchanged

- **GIVEN** an authorized native request with tool, image, thinking, cache-control or otherwise unknown business fields
- **WHEN** the request crosses the Relay
- **THEN** those fields are forwarded to Sub2API without business-payload parsing, removal or reserialization by the Relay
- **AND** Sub2API determines request validity and actual model capabilities

#### Scenario: Native upstream responses and errors are not rewritten

- **GIVEN** a native response or error produced by Sub2API
- **WHEN** the Relay forwards it to the client
- **THEN** the upstream HTTP status and business payload are preserved, subject only to necessary HTTP transport handling
- **AND** the native response does not pass through an OpenAI error-rewrite or synthetic model-metadata pipeline

#### Scenario: SSE is streamed rather than reconstructed

- **GIVEN** a Sub2API SSE response containing content, tool or thinking events, unknown events, or an upstream error
- **WHEN** that response crosses the Relay
- **THEN** event content and ordering are preserved without semantic decoding, reconstruction or added model events
- **AND** the Relay does not replay a native business request or move account-level failover and text billing out of Sub2API

#### Scenario: Native discovery is not aggregated with media

- **GIVEN** a request identified by the approved HTTP boundary as native Anthropic model discovery
- **WHEN** the client lists models or fetches model details
- **THEN** the Relay forwards the corresponding Sub2API response without injecting NewAPI media records, capability claims or an independently generated discovery envelope
- **AND** existing non-native aggregation behavior is maintained under its original contract

### Requirement: Existing authorization and billing remain authoritative

The Relay SHALL preserve existing user/Key permissions, explicit model restrictions, quota and wallet controls when adding Anthropic protocol support. Accepting a protocol or authentication header SHALL NOT grant access to private routes, models the user is not authorized to access, or bypass billing checks.

#### Scenario: Protocol authentication does not widen permissions

- **GIVEN** an API Key that lacks permission for the requested route or model
- **WHEN** the client uses an Anthropic-compatible authentication method
- **THEN** the request remains rejected according to the confirmed error contract
- **AND** no supplier request or customer charge is introduced by the rejected request

### Requirement: Claude access follows the existing Sub2API group

Claude access SHALL follow the existing Sub2API authorization and routing configuration for the request's group. A group that already admits Claude SHALL expose claude-fable-5, claude-fable-5-1, claude-opus-5, claude-opus-5-5, claude-sonnet-5 and claude-sonnet-5-5 according to its allowlist and model routes. The Relay SHALL NOT automatically add Claude to the default OpenAI group, broaden a Key's model permissions or require a separate protocol-only Key. Explicit administrative restrictions, quota, expiry, disabled status and wallet checks SHALL remain effective.

#### Scenario: An authorized group Key discovers and invokes Claude

- **GIVEN** a valid existing Key whose Sub2API group admits a supported Claude model
- **WHEN** the user discovers or invokes one of the six approved Claude models via the confirmed inference contract
- **THEN** Sub2API resolves the access using that group's existing authorization without a changed CheapBuddy Base URL or a protocol-only Key
- **AND** the Relay remains a transparent native HTTP forwarding layer

#### Scenario: Unified access retains explicit restrictions

- **GIVEN** a Key subject to an explicit model/channel restriction, exhausted quota, expiry, disabled status or insufficient wallet balance
- **WHEN** it attempts to access a Claude model with the unchanged credentials
- **THEN** the applicable restriction remains enforced by Sub2API
- **AND** the Relay does not grant access outside that restriction or the group's allowlist

#### Scenario: Model pricing follows the selected group configuration

- **GIVEN** an existing Key, an admitted Claude request and the request's selected Sub2API group
- **WHEN** Sub2API prices the request using the established group, channel, account and user pricing policy
- **THEN** the charge uses that policy without a Relay-side Claude multiplier or a protocol-specific surcharge
- **AND** the existing pricing policies for other model families and upstream cost accounting remain unchanged

### Requirement: Alternative protocol access for Claude

The public gateway SHALL offer Anthropic and OpenAI-compatible as alternative access protocols for the approved Claude models using the same existing CheapBuddy Base URL and API Key. A client MAY choose either protocol according to its capabilities. It SHALL NOT be required to use both protocols, submit the same inference through multiple interfaces or obtain separate credentials to access Claude. Chat Completions and Responses are existing interfaces within the OpenAI-compatible category, not a third protocol or a requirement to use every interface. The Relay SHALL transparently forward the selected request to Sub2API without independently implementing a protocol adapter; Sub2API remains authoritative for the corresponding native or compatible contract.

#### Scenario: The client chooses Anthropic directly

- **GIVEN** an authorized existing CheapBuddy Key and an admitted Claude model
- **WHEN** the client chooses the confirmed native Anthropic interface
- **THEN** its request is transparently forwarded to Sub2API under the corresponding contract
- **AND** no OpenAI-compatible call, new Key or changed Base URL is required to complete that inference

#### Scenario: The client chooses OpenAI-compatible directly

- **GIVEN** the same authorized existing Key and an admitted Claude model
- **WHEN** the client chooses a supported existing Sub2API OpenAI-compatible interface, such as Chat Completions or Responses
- **THEN** it can use that model through the selected compatible interface without switching to the native Anthropic client protocol
- **AND** the Relay adds no conversion stage, second inference or separate credential requirement

#### Scenario: Access and pricing remain consistent across the chosen protocols

- **GIVEN** the same authorized customer, unchanged Key, admitted Claude model and Sub2API group
- **WHEN** the customer chooses either available protocol for an inference
- **THEN** the same group authorization and group pricing configuration apply
- **AND** acceptance compares that selected interface against its contract in the same Sub2API version

### Requirement: Specification approval gates implementation

The change SHALL remain in requirements discovery until the user confirms shared understanding of the scope and acceptance criteria. After that confirmation, implementation and deployment MAY proceed against this specification. Previously written local attempts SHALL be treated as unapproved implementation candidates until they are revalidated against this specification.

#### Scenario: A compatibility decision is still open

- **GIVEN** unresolved target-client, endpoint or error-contract decisions
- **WHEN** requirements gathering continues
- **THEN** the next decision is discussed one question at a time with a recommendation
- **AND** no implementation, production configuration change or deployment is performed for this change
