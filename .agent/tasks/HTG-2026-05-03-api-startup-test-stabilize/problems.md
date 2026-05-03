# Problems

## Open

None.

## Closed

- Release workflow failed because the transient API handoff test had a timer race. The test harness now uses deterministic `fetchImpl`-driven handoff and local verification passes.
