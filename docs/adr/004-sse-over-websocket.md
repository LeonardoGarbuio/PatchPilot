# ADR-004 — Server-Sent Events over WebSocket for streaming

**Status:** Accepted  
**Date:** 2025-07

## Context

PatchPilot needs to stream real-time events (agent actions, file writes, test results) from the server to the browser UI while a job is running.

## Options considered

| Option | Protocol | Bidirectional | Reconnect | Complexity | HTTP/2 |
|---|---|---|---|---|---|
| Polling | HTTP | No | Native | Low | Yes |
| Long polling | HTTP | No | Native | Medium | Yes |
| **Server-Sent Events** | HTTP | Server→Client | Built-in | Low | Yes |
| WebSocket | WS | Yes | Manual | High | No (upgrade) |

## Decision

Use **Server-Sent Events (SSE)** via the native `text/event-stream` Content-Type.

## Rationale

PatchPilot's streaming is inherently **unidirectional**: the server pushes events to the browser. The browser never needs to send messages over the same connection — user actions (approve, reject, stop) are separate REST calls.

SSE advantages over WebSocket for this use case:

- Works over standard HTTP/1.1 and HTTP/2 — no protocol upgrade needed
- Proxy and CDN support is better (fewer issues with timeouts, buffering)
- Native browser `EventSource` API handles reconnection automatically
- Simpler server implementation — no handshake, no ping/pong, no fragmentation
- Fastify's raw response stream supports SSE without additional plugins

The `X-Accel-Buffering: no` header is set to prevent nginx from buffering SSE chunks.

A 25-second keep-alive comment (`: ping`) prevents proxy timeouts.

## Consequences

- The `EventSource` API does not support custom headers — JWT auth is done via the existing HTTP auth middleware before the SSE connection is established
- Each active job connection holds an open HTTP response — this is fine for the expected concurrent job count (≤10 per user)
- SSE does not support binary frames — all event data is JSON-encoded text
