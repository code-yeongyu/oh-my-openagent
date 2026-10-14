import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

const DISABLED_FLAG = "omo-senpi-kimi-todo-first-turn-disabled"
const FIRST_TURN_MARKER = '<system-reminder>\nThis is the first request of the session. Before continuing, call the todo tool with op "init" and a phased list'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function carriesReminder(message: unknown): boolean {
  if (!isRecord(message) || message.role !== "user") return false
  const content = message.content
  if (typeof content === "string") return content.includes(FIRST_TURN_MARKER)
  return Array.isArray(content) && content.some(block =>
    isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.includes(FIRST_TURN_MARKER),
  )
}

function branchOf(context: unknown): unknown[] {
  if (!isRecord(context) || !isRecord(context.sessionManager)) return []
  const manager = context.sessionManager
  if (typeof manager.getBranch !== "function") return []
  const branch: unknown = Reflect.apply(manager.getBranch, manager, [])
  return Array.isArray(branch) ? branch : []
}

function payloadHasTasks(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined
  // Match the host's restoration precedence, including legacy cancelled statuses.
  if (value.schema === "v2" || Array.isArray(value.phases)) {
    const phases = value.phases
    const statuses = ["pending", "in_progress", "completed", "abandoned", "cancelled"]
    if (!Array.isArray(phases) || !phases.every(phase =>
      isRecord(phase) && typeof phase.name === "string" && Array.isArray(phase.tasks) && phase.tasks.every(task =>
        isRecord(task) && typeof task.content === "string" && typeof task.status === "string" && statuses.includes(task.status),
      ),
    )) return undefined
    return phases.some(phase => phase.tasks.length > 0)
  }
  if (Array.isArray(value.todos) && value.todos.every(task => isRecord(task) && typeof task.content === "string")) return value.todos.length > 0
  return undefined
}

function hasTodoTasks(branch: unknown[]): boolean {
  for (const entry of branch.toReversed()) {
    if (!isRecord(entry)) continue
    const message = entry.message
    const value = entry.type === "custom" && entry.customType === "senpi.todo-state"
      ? entry.data
      : entry.type === "message" && isRecord(message) && message.role === "toolResult" && (message.toolName === "todo" || message.toolName === "todowrite")
        ? message.details
        : undefined
    const hasTasks = payloadHasTasks(value)
    if (hasTasks !== undefined) return hasTasks
  }
  return false
}

export function createKimiTodoFirstTurnComponent(): OmoSenpiComponent {
  return {
    name: "kimi-todo-first-turn",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("before_provider_request", (event, eventCtx) => {
        if (ctx.config.getFlag(DISABLED_FLAG) === true || !isRecord(event)) return undefined
        const model = event.model ?? (isRecord(eventCtx) ? eventCtx.model : undefined)
        if (!isRecord(model) || model.provider !== "kimi-coding" || model.id !== "k3" || model.api !== "anthropic-messages") return undefined
        const payload = event.payload
        if (!isRecord(payload) || !Array.isArray(payload.tools)) return undefined
        const branch = branchOf(eventCtx)
        const reminder = branch.findLastIndex(entry => isRecord(entry) && entry.type === "custom_message" && entry.customType === "senpi.todo-first-turn")
        // Startup prompt additions are staged before message_end persists them: the wire can
        // carry the opener while getBranch() still contains only model/thinking metadata.
        const messages = Array.isArray(payload.messages) ? payload.messages : []
        const wireReminder = messages.findLastIndex(carriesReminder)
        if (reminder < 0 && wireReminder < 0) return undefined
        if (wireReminder >= 0 && messages.slice(wireReminder + 1).some(message => isRecord(message) && message.role === "assistant")) return undefined
        if (reminder >= 0 && branch.slice(reminder + 1).some(entry => isRecord(entry) && entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant")) return undefined
        if (hasTodoTasks(branch)) return undefined

        let changed = false
        const tools = payload.tools.map(tool => {
          if (!isRecord(tool) || tool.name !== "todo" || !isRecord(tool.input_schema) || !isRecord(tool.input_schema.properties)) return tool
          const list = tool.input_schema.properties.list
          if (!isRecord(list) || list.type !== "array") return tool
          changed = true
          return {
            ...tool,
            description: 'First-turn initialization: pass op="init" and the complete phased list. Each list entry has phase and items (an array of task strings).',
            input_schema: {
              ...tool.input_schema,
              type: "object",
              properties: { op: { type: "string", enum: ["init"] }, list },
              required: ["op", "list"],
            },
          }
        })
        return changed ? { ...payload, tools } : undefined
      })
    },
  }
}
