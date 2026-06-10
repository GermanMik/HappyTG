# Problems

- Docker can now keep Mini App/API durable and read Codex Desktop projections through a read-only mount.
- Mutating Codex Desktop controls still require host-side access to Windows Codex Desktop / `codex app-server`.
- Running that mutating control directly in Docker is the wrong boundary because Docker is not the Windows user session.

## Working Approach

Add a host-side proxy process that runs on the Windows execution host and exposes a narrow local HTTP contract. Docker API will call it through `host.docker.internal`.
