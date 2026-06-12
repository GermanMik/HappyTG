# Problems

Task: `HTG-2026-06-12-desktop-sessions-timeout`

## Resolved

- The normal live 50-session Desktop list latency exceeded the Mini App fallback timeout.
- Raw AbortError text could leak into the user-facing partial-load warning.

## Residual Risks

- If Desktop session projection exceeds 6000ms, the Mini App will still fall back and show a timeout warning.
- Larger Desktop history should eventually use pagination/search instead of repeatedly loading the first 50 sessions for every list page.
