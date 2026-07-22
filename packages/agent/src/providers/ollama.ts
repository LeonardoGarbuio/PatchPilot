import type { AgentProvider, Message } from '../index.js'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'

export class OllamaProvider implements AgentProvider {
  private model: string

  constructor(model: string) {
    this.model = model
  }

  async chat(messages: Message[]): Promise<string> {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: 0.1, // low temperature for deterministic code changes
          num_ctx: 32768,
        },
      }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama API error ${res.status}: ${text}`)
    }

    const json = await res.json() as { message: { content: string } }
    return json.message.content
  }
}
