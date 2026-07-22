# Architecture — PatchPilot

## System overview

PatchPilot is a **local-first AI coding agent** structured as a monorepo with two deployable applications and four internal packages.

```
  ┌───────────────────────────────────────────────────┐
  │                  User Browser                      │
  │          React + TypeScript (Vite)                 │
  │              apps/web → Vercel                     │
  └──────────────────────┬────────────────────────────┘
                         │ REST + SSE
  ┌──────────────────────▼────────────────────────────┐
  │              Fastify API Server                    │
  │          apps/server → Railway                     │
  │                                                    │
  │  ┌──────────┐  ┌───────────┐  ┌────────────────┐  │
  │  │  Auth    │  │  Jobs     │  │   Providers    │  │
  │  │  Routes  │  │  Routes   │  │   Status       │  │
  │  └──────────┘  └─────┬─────┘  └────────────────┘  │
  │                      │                             │
  │  ┌───────────────────▼─────────────────────────┐  │
  │  │           Job Orchestrator                   │  │
  │  │    planning → running → verifying → done     │  │
  │  └──────┬──────────────────────────────────────┘  │
  │         │                                          │
  │  ┌──────▼──────┐  ┌──────────┐  ┌─────────────┐  │
  │  │  Drizzle    │  │   SSE    │  │   packages/ │  │
  │  │  SQLite     │  │  Manager │  │   (below)   │  │
  │  └─────────────┘  └──────────┘  └─────────────┘  │
  └───────────────────────────────────────────────────┘
                         │
  ┌──────────────────────▼────────────────────────────┐
  │              Internal Packages                     │
  │                                                    │
  │  @patchpilot/agent    ReAct loop, AI providers    │
  │       │                                            │
  │  @patchpilot/tools    read/search/write (secure)  │
  │                                                    │
  │  @patchpilot/sandbox  Docker lifecycle + policies  │
  │       │                                            │
  │  @patchpilot/git      diff, clone, copy, patch    │
  │                                                    │
  │  @patchpilot/shared   Zod schemas, state machine  │
  └───────────────────────────────────────────────────┘
                         │
  ┌──────────────────────▼────────────────────────────┐
  │              Docker Engine                         │
  │                                                    │
  │   ┌─────────────────────────────────────────┐     │
  │   │  Isolated Container (per job)            │     │
  │   │  Network: disabled                       │     │
  │   │  RAM: 512 MB max                         │     │
  │   │  CPU: 50% of 1 core                      │     │
  │   │  Capabilities: none (CapDrop ALL)        │     │
  │   │  Mount: /workspace (job copy only)       │     │
  │   └─────────────────────────────────────────┘     │
  └───────────────────────────────────────────────────┘
                         │
  ┌──────────────────────▼────────────────────────────┐
  │              Ollama (local)                        │
  │      http://localhost:11434                        │
  │      qwen2.5-coder:7b (default)                   │
  └───────────────────────────────────────────────────┘
```

---

## Data flow — one complete job

```
1.  User submits task via React UI
2.  POST /api/jobs → creates job record (status: idle)
3.  POST /api/repos/upload or /clone → copies repo to workspaces/<id>/
4.  POST /api/jobs/:id/plan → status: planning
5.  JobRunner.generatePlan() calls Ollama API
6.  Ollama returns structured plan (JSON array of PlanStep)
7.  status: awaiting_approval → SSE: plan_ready
8.  User reviews plan in UI and clicks "Approve and run"
9.  POST /api/jobs/:id/run → status: running
10. JobRunner.run() creates Docker container via dockerode
11. Agent ReAct loop begins (≤20 iterations):
    - assistant: { "action": "list_dir", "path": "/" }
    - tool result → fed back as user message
    - assistant: { "action": "read_file", "path": "src/auth.ts" }
    - assistant: { "action": "write_file", "path": "src/auth.ts", "content": "..." }
    - SSE: run_event fired for each action
12. status: verifying
13. sandbox.verify() runs: npm run lint, typecheck, test, build
14. Status: complete → SSE: complete
15. Container destroyed (AutoRemove + explicit destroy call)
16. User reviews diff in UI
17. POST /api/jobs/:id/approve → status: approved
18. GET /api/jobs/:id/patch → downloads .patch file
```

---

## Job state machine

```
idle ──► planning ──► awaiting_approval ──► running ──► verifying ──► complete ──► approved
  │           │               │               │             │               │
  │           └───────────────┴───────────────┴─────────────► failed        └──► rejected
  │                                                                   │
  └───────────────────────────────────────────────────────────────────┘
                                                            (retry)
```

Transitions are enforced by `assertTransition()` in `packages/shared/src/state-machine.ts`.

---

## Database schema

```sql
users          (id, name, email, password_hash, created_at)
jobs           (id, user_id, title, task, repo, source_type, status, provider,
                model, plan, risk_level, container_id, workspace_path,
                created_at, started_at, finished_at)
run_events     (id, job_id, type, title, detail, elapsed, timestamp)
file_changes   (id, job_id, path, status, diff, additions, deletions, created_at)
provider_configs (id, user_id, provider, base_url, model, updated_at)
```

---

## Security model details

### What the AI agent can do

| Action | Allowed | Notes |
|---|---|---|
| Read any file | ✓ | Except blocked patterns |
| List directories | ✓ | Skips node_modules, .git |
| Search file contents | ✓ | Skips blocked patterns |
| Write files inside /workspace | ✓ | Path validated, no traversal |
| Write files outside /workspace | ✗ | Hard error |
| Read .env / secret files | ✗ | Returns [REDACTED] |
| Run npm lint / test / build | ✓ | Allowlist enforced |
| Run arbitrary shell commands | ✗ | Not in allowlist |
| Make network requests | ✗ | Container `NetworkMode: none` |
| Push to remote | ✗ | No git credentials in container |
| Delete original repository | ✗ | Agent only has a copy |

### Why no WebAssembly sandbox instead of Docker?

See [ADR-002](adr/002-docker-sandbox.md).
