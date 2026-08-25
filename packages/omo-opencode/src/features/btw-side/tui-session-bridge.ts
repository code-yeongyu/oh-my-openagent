import type {
  TuiPluginApi,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui"

import type {
  BtwCreateSessionInput,
  BtwPromptRef,
  BtwSideControllerDependencies,
} from "./tui-controller-types"

export function unwrapTuiData<T>(
  response: {
    data?: T
    error?: unknown
  },
  message: string,
): T {
  if (response.error !== undefined || response.data === undefined) {
    throw new Error(message, {
      cause: response.error,
    })
  }
  return response.data
}

export function currentTuiSessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current
  if (route.name !== "session" || !route.params) return undefined
  const sessionID = route.params["sessionID"]
  return typeof sessionID === "string" ? sessionID : undefined
}

export function isCurrentTuiSession(
  api: TuiPluginApi,
  sessionID: string | undefined,
): boolean {
  return currentTuiSessionID(api) === sessionID
}

export function adaptTuiPromptRef(promptRef: TuiPromptRef): BtwPromptRef {
  return {
    get hasAttachments() {
      return promptRef.current.parts.length > 0
    },
    get input() {
      return promptRef.current.input
    },
    set(input) {
      promptRef.set({
        ...promptRef.current,
        input,
      })
    },
    submit() {
      promptRef.submit()
    },
  }
}

export function parentTuiStatusLabel(
  api: TuiPluginApi,
  parentSessionID: string,
): string {
  if (api.state.session.permission(parentSessionID).length > 0) {
    return "main needs permission"
  }
  if (api.state.session.question(parentSessionID).length > 0) {
    return "main needs input"
  }
  return api.state.session.status(parentSessionID)?.type === "busy"
    ? "main working"
    : "main ready"
}

export function createBtwControllerDependencies(
  api: TuiPluginApi,
): BtwSideControllerDependencies {
  return {
    getCurrentSessionID: () => currentTuiSessionID(api),
    getSession: (sessionID) => {
      const session = api.state.session.get(sessionID)
      if (!session) return undefined
      return {
        id: session.id,
        title: session.title,
        ...(session.agent ? { agent: session.agent } : {}),
        ...(session.model
          ? {
              model: {
                providerID: session.model.providerID,
                id: session.model.id,
              },
            }
          : {}),
      }
    },
    getMessages: (sessionID) =>
      api.state.session.messages(sessionID).map((message) => ({
        info: {
          id: message.id,
          role: message.role,
          ...(message.role === "assistant"
            ? {
                time: {
                  completed: message.time.completed,
                },
              }
            : {}),
        },
      })),
    createSession: async (input: BtwCreateSessionInput) => {
      const session = unwrapTuiData(
        await api.client.session.create({
          ...input,
          directory: api.state.path.directory,
        }),
        "Unable to create BTW session",
      )
      return {
        id: session.id,
        title: session.title,
      }
    },
    navigateSession: (sessionID) => {
      api.route.navigate("session", { sessionID })
    },
    abortSession: async (sessionID) => {
      unwrapTuiData(
        await api.client.session.abort({
          sessionID,
          directory: api.state.path.directory,
        }),
        "Unable to abort BTW session",
      )
    },
    deleteSession: async (sessionID) => {
      unwrapTuiData(
        await api.client.session.delete({
          sessionID,
          directory: api.state.path.directory,
        }),
        "Unable to delete BTW session",
      )
    },
    showToast: (message) => {
      api.ui.toast({
        variant: "warning",
        message,
      })
    },
    requestRender: () => api.renderer.requestRender(),
  }
}

