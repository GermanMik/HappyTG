# Problems

- No scoped product problems remain after the Windows Telegram transport fallback fix.
- Operational note: any already-running local bot process must be restarted to pick up the new runtime; otherwise `/ready` continues to reflect the old process state.
