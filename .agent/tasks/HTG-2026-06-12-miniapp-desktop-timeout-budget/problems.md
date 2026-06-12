# Problems

## Fixed

- Project-filtered Codex Desktop views used `limit=100` but still had the same `6000ms` fetch timeout as the default `limit=50` view.

## Residual

- Desktop session list performance still scales with requested history size. Full pagination/search remains the right larger follow-up if history volume continues growing.
