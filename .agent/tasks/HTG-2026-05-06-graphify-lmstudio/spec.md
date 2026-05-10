# HTG-2026-05-06-graphify-lmstudio

## Scope

Build a Graphify knowledge graph for `C:\Develop\Projects\HappyTG`.

## Acceptance Criteria

- Retrieve EchoVault project context before work.
- Detect the repository corpus.
- Generate Graphify outputs under `graphify-out/`.
- Use the local LM Studio OpenAI-compatible endpoint for semantic extraction when available.
- Do not use cloud LLM backends or Ollama fallback.
- Record raw command output in this task bundle.

## Out of Scope

- Code changes to HappyTG runtime packages.
- Git commits.
- Persisting secrets, API keys, bot tokens or credentials.
