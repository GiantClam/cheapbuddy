# CheapBuddy Provider for Hypit

Project-owned Hypit Endpoint Provider for api.cheapbuddy.cc.

The first release targets the fastest usable Hypit path:

- @hypit/gpt-image@1#gpt-image-2
- @hypit/seedance@1#seedance-2-mini
- @hypit/minimax-h3@1#minimax-h3
- @hypit/mimo-speech@1#mimo-v2.5-tts-voicedesign
- @hypit/fishaudio-speech@1#voice-design-1
- @hypit/fishaudio-speech@1#voice-clone

References are sent as bounded Data URLs in the request body. This avoids
requiring the first release to implement HypiHub persistent file uploads.
Keep reference inputs below 48 MiB.

Install from the CheapBuddy checkout:

    npm install ./hypit-provider

The complete runtime example is in `hypit.runtime.example.json`.

The active Hypit Distribution supplies the public `@hypit/hypit/*` SDK imports;
this package intentionally does not install a second copy of the Hypit
workspace.

Configure an endpoint in hypit.runtime.json:

    {
      "endpoints": {
        "cheapbuddy.media": {
          "use": "@cheapbuddy/provider-hypit",
          "pool": "cheapbuddy-media",
          "config": {
            "baseUrl": "https://api.cheapbuddy.cc",
            "apiKey": { "store": "platform", "key": "cheapbuddy.api" }
          }
        }
      }
    }

Bind the capabilities used by the first Hypit workflow to this endpoint:

    {
      "bindings": {
        "@hypit/gpt-image@1#gpt-image-2": "cheapbuddy.media",
        "@hypit/seedance@1#seedance-2-mini": "cheapbuddy.media",
        "@hypit/minimax-h3@1#minimax-h3": "cheapbuddy.media",
        "@hypit/mimo-speech@1#mimo-v2.5-tts-voicedesign": "cheapbuddy.media",
        "@hypit/fishaudio-speech@1#voice-design-1": "cheapbuddy.media",
        "@hypit/fishaudio-speech@1#voice-clone": "cheapbuddy.media",
        "@hypit/whisperx@1#whisperx-alignment": "cheapbuddy.media"
      }
    }

The CheapBuddy Relay must have these exact media model IDs in
`RELAY_VERIFIED_MODELS`, with matching reservation, multiplier and billing
entries. The public Relay paths required by this package are
`/v1/images/generations`, `/v1/images/edits`, `/v1/images/tasks`,
`/v1/videos`, `/v1/audio/speech`, and `/v1/audio/transcriptions`.

The API key is the ordinary CheapBuddy user key. The provider never receives
or exposes the NewAPI shadow token.

Hypit's `pricing` command uses the Endpoint's authenticated rate reader:

- `GET /v1/pricing?model={service-model}`
- The Relay returns that account's matching NewAPI rate-card record, the
  default-group ratio, and CheapBuddy's model-specific media multiplier.
- Original billing fields and units are preserved. The reader does not guess
  future video duration; final usage billing remains based on a successful
  task's measured usage.

The public endpoint contract is documented in `relay/ROUTE_CONTRACT.md`.
