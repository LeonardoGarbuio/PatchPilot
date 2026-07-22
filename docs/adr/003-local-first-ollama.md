# ADR-003 — Ollama as the default AI provider

**Status:** Accepted  
**Date:** 2025-07

## Context

PatchPilot needs an AI model for planning and code generation. The choice of provider has significant implications for privacy, cost, and offline capability.

## Options considered

| Option | Privacy | Cost | Offline | Code quality |
|---|---|---|---|---|
| OpenAI GPT-4 | Low (data sent to API) | ~$0.03/1K tokens | No | Excellent |
| Anthropic Claude | Low | ~$0.015/1K tokens | No | Excellent |
| **Ollama (local)** | Full | Free | Yes | Good (qwen2.5-coder) |
| Groq (API) | Low | Free tier | No | Good |

## Decision

Default to **Ollama with `qwen2.5-coder:7b`**, with optional bring-your-own-key support for OpenAI and Anthropic.

## Rationale

PatchPilot's core value proposition includes privacy: *your code stays local*. Defaulting to a cloud API would contradict this. Ollama:

- Runs 100% on the user's machine — no code ever leaves
- Is free: no API costs for development or moderate production use
- `qwen2.5-coder:7b` has strong code understanding for its size
- Supports streaming via the `/api/chat` endpoint
- Can be swapped for any GGUF-compatible model

The BYOK (bring-your-own-key) option for OpenAI/Anthropic is provided for users who want higher model quality and accept the privacy trade-off. Keys are stored as environment variables and never persisted to the database.

## Consequences

- Ollama must be installed and running on the host
- First use requires `ollama pull qwen2.5-coder:7b` (~4 GB download)
- Response latency is hardware-dependent (GPU recommended, CPU works)
- The `OLLAMA_BASE_URL` environment variable allows pointing at a remote Ollama instance
