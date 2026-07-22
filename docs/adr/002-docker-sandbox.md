# ADR-002 — Docker containers for sandbox isolation

**Status:** Accepted  
**Date:** 2025-07

## Context

The AI agent needs to run commands (lint, test, build) and write files in a way that is completely isolated from the host machine. We need a sandbox that:

1. Cannot access or modify the original repository
2. Cannot make outbound network calls during the edit phase
3. Has bounded resource consumption (RAM, CPU)
4. Is destroyed deterministically after use

## Options considered

| Option | Isolation | Resource limits | Network control | Overhead |
|---|---|---|---|---|
| Direct process execution | None | None | None | None |
| **Docker containers** | Full | Yes (cgroups) | Yes (`NetworkMode: none`) | Low (~1s startup) |
| VMs (QEMU, Firecracker) | Full | Yes | Yes | High (5-10s startup) |
| WebAssembly (WASM) | Partial | Limited | Yes | Medium |
| Node.js `vm` module | Partial | None | None | None |

## Decision

Use **Docker containers via the dockerode SDK** with explicitly hardened configuration.

## Rationale

- Docker is already required by most development environments; no new dependency for users
- `NetworkMode: none` completely disables all outbound traffic — stronger than firewall rules
- cgroups enforce `Memory: 512 MB` and `CpuQuota: 50_000` without any host configuration
- `CapDrop: ALL` + `no-new-privileges: true` prevent privilege escalation
- `AutoRemove: true` ensures the container is deleted even if the process crashes
- Startup time (~1s) is acceptable for the use case
- The dockerode SDK provides a complete TypeScript API

## Consequences

- Docker Desktop must be running on the host
- The server process requires access to the Docker socket (`/var/run/docker.sock`)
- On Railway (deployment), Docker-in-Docker must be enabled
- Each job requires ~512 MB of available RAM on the host
