import type { Plugin, ToolDefinition } from "@opencode-ai/plugin"
import type { TmuxConfig } from "@oh-my-opencode/tmux-core"

export type PluginContext = Parameters<Plugin>[0]
export type PluginInstance = Awaited<ReturnType<Plugin>>

type ChatHeadersHook = PluginInstance extends { "chat.headers"?: infer T }
  ? T
  : (input: unknown, output: unknown) => Promise<void>

export type PluginInterface = Omit<
  PluginInstance,
  "experimental.session.compacting" | "chat.headers"
> & {
  "chat.headers"?: ChatHeadersHook
}

export type ToolsRecord = Record<string, ToolDefinition>

export type { TmuxConfig }
