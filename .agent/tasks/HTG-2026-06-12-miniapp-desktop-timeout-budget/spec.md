# HTG-2026-06-12-miniapp-desktop-timeout-budget

## Scope

Fix the Mini App follow-up timeout where project-filtered Codex Desktop session views can render:

```text
Desktop sessions unavailable: request timed out after 6000ms.
```

## Acceptance Criteria

- Project-filtered Codex Desktop views keep the widened `limit=100` session request from `0.4.25`.
- Desktop session list requests with `limit >= 100` receive a scoped timeout budget that is higher than the default `6000ms`.
- The default unfiltered `limit=50` Desktop session list keeps the configured/default timeout behavior.
- Add regression coverage for the slow project-view `limit=100` path.
- Run scoped Mini App validation and release validation.

## Non-goals

- No Codex Desktop mutation behavior changes.
- No auth, policy, approval, or transport behavior changes.
- No broad Desktop history pagination/search rewrite in this patch.
