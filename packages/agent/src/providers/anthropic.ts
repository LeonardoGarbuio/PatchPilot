import Anthropic from '@anthropic-ai/sdk'
import type { AgentProvider, Message } from '../index.js'

export class AnthropicProvider implements AgentProvider {
  private client: Anthropic
  private model: string

  constructor(model: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable not set')

    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async chat(messages: Message[]): Promise<string> {
    const systemMessage = messages.find(m => m.role === 'system')?.content || ''
    const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

    const completion = await this.client.messages.create({
      model: this.model,
      system: systemMessage,
      messages: userMessages,
      max_tokens: 4096,
      temperature: 0.1,
    })

    if (completion.content[0].type === 'text') {
      return completion.content[0].text
    }
    
    return ''
  }
}
