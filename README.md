# PatchPilot

[![CI](https://github.com/your-handle/patchpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/your-handle/patchpilot/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://patchpilot.vercel.app)

> **AI proposes. Docker protects. Tests verify. You decide.**

PatchPilot is a local-first AI coding agent that makes changes inside isolated Docker containers, runs the project's full verification suite, and presents a line-by-line diff for human approval — before a single byte of your original repository is touched.

---

## The problem

Every AI coding tool today has the same failure mode: it makes changes directly to your codebase, sometimes breaks things, and gives you no structured way to understand or control what happened.

PatchPilot inverts this model. The AI works in a **disposable copy** of your code, inside a **network-isolated container**. You see the complete plan before it starts, a live event feed while it runs, and a full diff before you decide whether to apply anything.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PatchPilot Flow                                   │
│                                                                              │
│  1. You describe a task          "Add Zod validation to auth routes"         │
│  2. AI generates a plan          5 steps, shown for your approval            │
│  3. Docker container spawns      isolated, network-off, 512 MB RAM cap       │
│  4. AI reads → edits → tests     full ReAct loop, ≤20 steps                 │
│  5. Verification runs            lint → typecheck → tests → build            │
│  6. You review the diff          line-by-line, file-by-file                  │
│  7. You approve or reject        nothing reaches your repo without approval  │
│  8. Container is destroyed       zero artifacts left behind                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Security model

This is the part that separates PatchPilot from "just a chatbot that writes code."

| Guarantee | Mechanism |
|---|---|
| **Original repo never modified** | Agent works in a copy; original path is read-only |
| **No network access during editing** | `NetworkMode: none` on Docker container |
| **RAM bounded** | `Memory: 512 MB`, `MemorySwap: 512 MB` (no swap escape) |
| **CPU bounded** | `CpuQuota: 50_000` (50% of one core) |
| **No Linux capability escalation** | `CapDrop: ALL`, `no-new-privileges: true` |
| **Secrets never sent to the AI** | `.env`, `*.key`, `*.pem` files are blocked at the tool layer |
| **Path traversal impossible** | All file writes validated to stay inside `/workspace` |
| **Only safe commands run** | Allowlist: lint, typecheck, test, build — no arbitrary shell |
| **Container destroyed on finish** | `AutoRemove: true`, destroy called explicitly in finally block |
| **No push without approval** | Human must explicitly click Approve; no automated remote operations |

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Type-safe, fast HMR, excellent DX |
| Backend API | Fastify + TypeScript | 2-3× faster than Express, schema-first |
| Database | Drizzle ORM + SQLite | Zero-config, type-safe, file-based |
| AI (local) | Ollama — `qwen2.5-coder:7b` | Free, private, works offline |
| AI (cloud) | OpenAI SDK — bring your own key | Optional fallback |
| Containers | dockerode — Docker Engine API | First-class Node.js Docker SDK |
| Real-time | Server-Sent Events (SSE) | Simpler than WebSocket for unidirectional streaming |
| Diff/patch | `diff` npm package | Generates standard unified diffs |
| Monorepo | pnpm workspaces + Turborepo | Intelligent caching, parallel builds |
| CI/CD | GitHub Actions | Automated typecheck + test + build |
| Deploy (web) | Vercel | Zero-config for Vite |
| Deploy (api) | Railway | Native Docker-in-Docker support |

---

## Getting started

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker Desktop (running)
- Ollama — [download](https://ollama.com/download) + `ollama pull qwen2.5-coder:7b`

### Install and run

```bash
git clone https://github.com/your-handle/patchpilot
cd patchpilot

pnpm install

# Copy env vars
cp apps/server/.env.example apps/server/.env

# Run migrations
pnpm --filter @patchpilot/server db:migrate

# Start everything
pnpm dev
```

Open `http://localhost:5173` for the UI and `http://localhost:3001/health` to verify the API.

---

## Project structure

```
PatchPilot/
├── apps/
│   ├── web/              React + Vite frontend → Vercel
│   └── server/           Fastify API + job orchestrator → Railway
├── packages/
│   ├── shared/           Zod schemas, types, job state machine
│   ├── agent/            Provider-independent ReAct agent loop
│   ├── tools/            Controlled file tools (read/search/write with security)
│   ├── sandbox/          Docker lifecycle, security policies, verification
│   └── git/              Clone, copy, diff, and .patch generation
├── docs/
│   ├── architecture.md   System design and data flow
│   └── adr/              Architecture Decision Records
└── .github/
    └── workflows/        CI pipeline (typecheck + lint + test + build)
```

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Get JWT token |
| `GET` | `/api/jobs` | List user's jobs |
| `POST` | `/api/jobs` | Create a new job |
| `GET` | `/api/jobs/:id` | Full job details + events + changes |
| `POST` | `/api/jobs/:id/plan` | Trigger plan generation |
| `POST` | `/api/jobs/:id/run` | Approve plan and start execution |
| `POST` | `/api/jobs/:id/approve` | Approve completed job |
| `POST` | `/api/jobs/:id/reject` | Reject job |
| `GET` | `/api/jobs/:id/stream` | SSE stream of live events |
| `GET` | `/api/jobs/:id/patch` | Download `.patch` file |
| `POST` | `/api/repos/upload` | Upload ZIP repository |
| `POST` | `/api/repos/clone` | Clone public GitHub/GitLab URL |
| `GET` | `/api/providers/status` | Check Ollama + Docker availability |

---

## Roadmap

- [x] Interactive UI with full job flow
- [x] Monorepo architecture (pnpm + Turborepo)
- [x] Fastify API with JWT auth
- [x] Drizzle ORM + SQLite persistence
- [x] Docker sandbox with security policies
- [x] Ollama + OpenAI provider support
- [x] ReAct agent loop with tool allowlist
- [x] SSE real-time log streaming
- [x] Unified diff generation
- [x] .patch file download
- [x] GitHub Actions CI
- [ ] Monaco Editor integration
- [ ] Inline diff comments
- [ ] GitHub PR creation
- [ ] Project memory (persist decisions across jobs)
- [ ] Multi-solution comparison
- [ ] Test generation before bug fixes
- [ ] Cross-file impact analysis

---

## Architecture decisions

See [`docs/adr/`](docs/adr/) for the reasoning behind key technical choices:

- [ADR-001](docs/adr/001-monorepo-pnpm.md) — Why pnpm workspaces + Turborepo
- [ADR-002](docs/adr/002-docker-sandbox.md) — Why Docker over VMs or WebAssembly
- [ADR-003](docs/adr/003-local-first-ollama.md) — Why Ollama as the default provider
- [ADR-004](docs/adr/004-sse-over-websocket.md) — Why SSE over WebSocket for streaming

---

## License

MIT — see [LICENSE](LICENSE)
