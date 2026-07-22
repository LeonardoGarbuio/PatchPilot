import OpenAI from 'openai'
import type { AgentProvider, Message } from '../index.js'

export class OpenAIProvider implements AgentProvider {
  private client: OpenAI
  private model: string

  constructor(model: string) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable not set')

    this.client = new OpenAI({ apiKey })
    this.model = model
  }

  async chat(messages: Message[]): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.1,
      max_tokens: 4096,
    })

    return completion.choices[0]?.message?.content ?? ''
  }
}
