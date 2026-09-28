# CheapBuddy OpenSpec Project Conventions

- Production deployment is Railway-only.
- CheapBuddy remains API-first; do not add creative media UI or media storage.
- Preserve existing user changes and use small, reversible edits.
- Relay changes belong under `relay/` in this repository.
- Sub2API and NewAPI remain independently deployed upstream services.
- Prefer native upstream request/response contracts and capabilities.
- Relay must not duplicate NewAPI provider, task, or billing formulas.
- Use explicit UTF-8 files and add tests for new behavior.
