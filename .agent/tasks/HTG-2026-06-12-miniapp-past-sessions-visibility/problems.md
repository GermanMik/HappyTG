# Problems

Task: `HTG-2026-06-12-miniapp-past-sessions-visibility`

## Resolved

- Project-filtered Codex Desktop views could hide past sessions because the UI filtered after fetching only the first `50`.
- Desktop sessions without `projectPath` were hidden from every project view.
- `limit=200` initial project reads could exceed the Mini App timeout and collapse to an empty fallback.

## Residual Risks

- Full history still needs proper pagination/search beyond `200`.
- Unscoped Desktop sessions are shown with a notice because Codex Desktop did not provide enough project attribution.
