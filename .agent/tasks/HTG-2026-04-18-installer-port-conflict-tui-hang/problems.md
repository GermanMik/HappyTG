# Problems

- No open blocking problems in scoped installer/TUI behavior after the shared confirm-key fix.
- Residual risk: this coverage is deterministic for Node keypress events (`enter`, `return`, `\r`, `\n`) but cannot fully simulate every third-party terminal quirk. The common confirm helper now covers the installer prompt surfaces that were previously inconsistent.
