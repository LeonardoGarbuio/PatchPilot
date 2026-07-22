# ADR-001 — Monorepo with pnpm workspaces and Turborepo

**Status:** Accepted  
**Date:** 2025-07

## Context

PatchPilot has five distinct logical components: the web UI, the API server, the AI agent, the Docker sandbox, and the shared type system. These need to be developed and tested independently but share code without publishing to npm.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Single package | Simple setup | No separation of concerns, everything in one bundle |
| Multiple repos | Full isolation | No code sharing, no atomic commits, painful to sync |
| Monorepo with npm workspaces | Built-in, zero deps | Slow, no build caching |
| **Monorepo with pnpm workspaces + Turborepo** | Fast, cached, standard | Small learning curve |

## Decision

Use **pnpm workspaces** for dependency management and **Turborepo** for task orchestration with remote caching.

## Rationale

- pnpm's symlink strategy means `@patchpilot/shared` is available in `apps/server` without publishing
- Turborepo caches build outputs — if `packages/shared` hasn't changed, its build is skipped
- The `turbo run build` pipeline ensures packages are built in the correct dependency order
- Single `pnpm install` at the root installs everything
- CI runs `pnpm install --frozen-lockfile` for reproducible builds

## Consequences

- All packages must declare their inter-dependencies as `workspace:*`
- TypeScript paths must be configured for workspace resolution
- Each package needs its own `tsconfig.json` extending the root
