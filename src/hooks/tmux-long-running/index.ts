import type { Message, Part } from "@opencode-ai/sdk"

export type { TmuxLongRunningConfig } from "./types"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

const TMUX_RULE_TEXT = `[System Rule: Long-Running Commands]
For commands matching these patterns, use \`interactive_bash\` (tmux) instead of regular Bash:
- Package managers: npm/pnpm/yarn/bun install, test, build, dev
- Build tools: cargo build/test, pytest, go test, docker build/compose, make
- Dev servers: npm run dev, vite, next dev

This prevents blocking the main session and allows monitoring.
Use \`interactive_bash\` with tmux commands like: new-session -d -s name, send-keys -t name "command" Enter`

const TMUX_NOT_INSTALLED_WARNING = `[System Warning: tmux not installed]
Long-running commands (npm install, cargo build, etc.) will run in regular Bash.
This may block the main session. Install tmux for better experience: brew install tmux`

async function checkTmuxInstalled(): Promise<boolean> {
  try {
    const result = await Bun.$`which tmux`.text()
    return !!result.trim()
  } catch {
    return false
  }
}

export function createTmuxLongRunningHook() {
  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] }
    ) => {
      const tmuxInstalled = await checkTmuxInstalled()

      const { messages } = output
      if (messages.length === 0) return

      // Find last user message
      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }
      if (lastUserMessageIndex === -1) return

      const lastUserMessage = messages[lastUserMessageIndex]

      // Find text part index
      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => p.type === "text" && (p as { text?: string }).text
      )
      if (textPartIndex === -1) return

      // Choose rule text based on tmux availability
      const ruleText = tmuxInstalled ? TMUX_RULE_TEXT : TMUX_NOT_INSTALLED_WARNING

      // Create synthetic part with rule
      const syntheticPart = {
        id: `tmux-long-running_${Date.now()}`,
        messageID: lastUserMessage.info.id,
        sessionID: (lastUserMessage.info as { sessionID?: string }).sessionID ?? "",
        type: "text" as const,
        text: ruleText,
        synthetic: true,
      }

      // Insert before the text part
      lastUserMessage.parts.splice(textPartIndex, 0, syntheticPart as Part)
    },
  }
}
