# Problems

- Standard `graphify extract` supports `kimi|claude` cloud backends and an Ollama profile, but this project policy prefers LM Studio and forbids Ollama fallback.
- The loaded LM Studio chat model has a small effective context window, so the default Graphify 20k-character file cap can truncate JSON output.
- The corpus contains one image; this local text extraction pass does not perform vision extraction.
