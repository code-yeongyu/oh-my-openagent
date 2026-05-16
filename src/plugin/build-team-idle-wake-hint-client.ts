import type { PluginInput } from "@opencode-ai/plugin"

type SdkSession = PluginInput["client"]["session"]
type SdkPromptAsync = SdkSession["promptAsync"]
type SdkStatus = SdkSession["status"]

export type TeamIdleWakeHintNarrowClient = {
  session: {
    promptAsync?: SdkPromptAsync
    status?: SdkStatus
  }
}

export function buildTeamIdleWakeHintClient(client: PluginInput["client"]): TeamIdleWakeHintNarrowClient {
  const session = client.session
  const promptAsync = typeof session.promptAsync === "function"
    ? session.promptAsync.bind(session) as SdkPromptAsync
    : undefined
  const status = typeof session.status === "function"
    ? session.status.bind(session) as SdkStatus
    : undefined
  return {
    session: { promptAsync, status },
  }
}
