import type { ToolDefinition } from '../../../shared/types.js'
import type { AgentTool } from './types.js'

export class ToolRegistry {
  private tools = new Map<string, AgentTool>()

  register(tool: AgentTool) {
    this.tools.set(tool.name, tool)
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values())
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
      parameters: t.parameters,
    }))
  }
}
