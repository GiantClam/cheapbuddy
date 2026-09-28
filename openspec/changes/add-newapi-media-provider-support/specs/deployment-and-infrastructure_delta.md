# Delta: Portable NewAPI Deployment and CheapBuddy Integration Boundary

**Change ID:** `add-newapi-media-provider-support`
**Affects:** NewAPI plugin deployment, Qingyan channel configuration, CheapBuddy network boundary

## ADDED

### Requirement: Portable standalone NewAPI deployment

MiniMax-H3 MUST be deployable as an independently usable NewAPI capability. A standalone deployment MUST contain a pinned NewAPI build compatible with Task Plugin API v1, `ecophase_minimax_h3`, NewAPI-required persistent services, protected administration, an authenticated native user API, and its own Qingyan channel secret.

It MUST NOT require CheapBuddy Relay, Sub2API, CheapBuddy database/cache state, CheapBuddy credentials, CheapBuddy user mappings, or CheapBuddy billing configuration.

#### Scenario: Second NewAPI installation

- GIVEN an operator deploys another compatible NewAPI environment
- WHEN the operator installs the plugin and configures a different Qingyan credential and local model/quota configuration
- THEN its authenticated users can use MiniMax-H3 without reaching the original CheapBuddy deployment

### Requirement: Protected server-side channel configuration

The Qingyan base URL, API key, provider model, alias, polling policy, and standalone NewAPI quota policy MUST be held in NewAPI configuration or an approved secret store. They MUST NOT appear in plugin source, browser assets, client configuration, logs, task responses, files, or artifacts.

NewAPI administration and channel management MUST be private or separately operator-protected. A standalone deployment may expose its authenticated native user API as its business endpoint.

### Requirement: CheapBuddy private upstream topology

When CheapBuddy publishes MiniMax-H3, Relay MUST be the user-facing API boundary. The NewAPI and Sub2API user/admin interfaces MUST be private-network services or separately protected operator surfaces. Relay uses server-side integration credentials and per-user encrypted NewAPI shadow tokens; clients receive neither NewAPI nor Qingyan credentials.

#### Scenario: Bypass attempt

- GIVEN an external client attempts to reach the CheapBuddy-integrated NewAPI or Sub2API endpoint directly
- WHEN network and operator access policy are applied
- THEN the request is rejected or unavailable
- AND no task, wallet, channel, or secret data is disclosed

### Requirement: Origin-agnostic plugin invocation

NewAPI invokes the plugin with the same host context regardless of whether a request came directly to a standalone NewAPI user API or through CheapBuddy Relay. The selected NewAPI deployment may use a different channel/secret from another deployment, but the plugin implementation and interface remain the same.

### Requirement: Temporary media lifecycle

The first release MUST use NewAPI request-scoped multipart handling, Qingyan temporary references, and NewAPI artifacts. It MUST NOT add a persistent CheapBuddy file API, media library, object store, CDN, or local media volume. Raw `mm_file://` references remain disabled until NewAPI exposes an ownership-checked file registry.

Relay may expose only the tested multipart video submission route. It MUST stream request bodies when possible and use only an ephemeral idempotency spool when an exact pre-submit hash is required. Completed content uses NewAPI artifact/content delivery; it must not expose raw Qingyan URLs or claim retention beyond provider/NewAPI lifetime.

## MODIFIED

### Requirement: Model release process

MiniMax-H3 must first satisfy standalone NewAPI plugin, request-scoped multipart, task, streaming, and native bill verification. CheapBuddy may enable it only after Relay model routing, response/video mappings, streamed uploads, ownership, reservation, reconciliation, and security tests pass. Standalone success does not automatically enable the public CheapBuddy model.

## REMOVED

- A requirement for the plugin or standalone NewAPI to depend on CheapBuddy deployment data.
- A requirement for CheapBuddy to host Qingyan adapter code, polling, callbacks, provider streaming, or permanent media storage.
