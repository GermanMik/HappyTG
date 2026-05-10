# Evidence

## Context

- EchoVault project context was retrieved before work.
- Existing `graphify-out/GRAPH_REPORT.md` was absent before the run.
- LM Studio endpoint `http://localhost:1234/v1/models` was reachable and listed `google/gemma-4-e2b`.

## Build

- Deterministic AST graph was generated first with `graphify update C:\Develop\Projects\HappyTG`.
- Local LM Studio semantic extraction was then run with:
  - model: `google/gemma-4-e2b`
  - base URL: `http://localhost:1234/v1`
  - chunks: 34
  - cloud backends: not used
  - Ollama fallback: not used

## Outputs

- `graphify-out/graph.json`
- `graphify-out/graph.html`
- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/.graphify_semantic.json`

## Verification

Result:

- `graph.json parse: PASS`
- nodes: 1092
- edges: 2736
- communities: 48
- semantic nodes: 243
- semantic edges: 261
- LM Studio tokens: 63852 input / 54733 output

## Limitations

- One image file was detected and skipped by this local text-only semantic pass.
- Several LM Studio chunks needed retry/splitting after invalid JSON; retries completed successfully.

## Release Cleanup

The 0.4.14 release branch keeps the publish-facing graph artifacts and summary evidence, but omits local generation residue such as cache files, `.graphify_*` intermediates, machine-specific manifests, stale semantic summary JSON, `.pyc`, `.pid`, and raw logs.
