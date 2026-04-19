# Verification Findings

## Findings

- The first full `pnpm test` attempt failed on a transient local `apps/api` handoff-port race with `Port 53271 is already in use by another process`. The isolated rerun of the failing test passed, and the subsequent full `pnpm test` rerun passed without any code change.
- `pnpm happytg doctor` and `pnpm happytg verify` both returned warning-level Codex websocket fallback (`403 Forbidden` followed by HTTP fallback) plus running-stack reuse info. Both commands still exited `0`.

## Summary

Release `0.3.22` is published. Metadata alignment, release-prep commit push, fast-forward of `main`, workflow execution, tag creation, GitHub Release publication, and final task-bundle validation all completed successfully.
