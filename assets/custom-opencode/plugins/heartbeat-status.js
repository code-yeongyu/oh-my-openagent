const HEARTBEAT_INTERVAL_MS = 20_000
const SILENCE_THRESHOLD_MS = 15_000
const HEARTBEAT_TOAST_DURATION_MS = 5_000
const RETRY_TOAST_DURATION_MS = 8_000
const ERROR_TOAST_DURATION_MS = 10_000
const STATE_CHANGE_TOAST_DURATION_MS = 4_000

const HARD_PROVIDER_BLOCK_PATTERNS = [
  /blocked by a gateway or proxy/i,
  /check your account and provider settings/i,
  /may not have permission to access this resource/i,
]

const CLEANUP_KEY = "__opencodeHeartbeatStatusCleanup"
const WAITING_TOOL_NAMES = new Set(["task"])
const RESUME_TOOL_NAMES = new Set(["background_output"])

function clone(value) {
  if (value === undefined) {
    return undefined
  }

  return JSON.parse(JSON.stringify(value))
}

function extractErrorMessage(error) {
  if (!error) {
    return ""
  }

  if (typeof error === "string") {
    return error
  }

  if (typeof error?.data?.message === "string") {
    return error.data.message
  }

  if (typeof error?.message === "string") {
    return error.message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function extractStatusCode(error) {
  if (!error || typeof error !== "object") {
    return undefined
  }

  return error.statusCode ?? error.status ?? error.data?.statusCode ?? error.error?.statusCode
}

function isHardProviderBlock(error) {
  const statusCode = extractStatusCode(error)
  const message = extractErrorMessage(error)

  return statusCode === 403 && HARD_PROVIDER_BLOCK_PATTERNS.some((pattern) => pattern.test(message))
}

function pluralizeRu(count, one, few, many) {
  const mod10 = count % 10
  const mod100 = count % 100

  if (mod10 === 1 && mod100 !== 11) {
    return one
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }

  return many
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes <= 0) {
    return `${seconds}с`
  }

  if (minutes < 60) {
    return `${minutes}м ${seconds}с`
  }

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return `${hours}ч ${restMinutes}м`
}

function formatRetryDelay(next) {
  if (typeof next !== "number" || Number.isNaN(next)) {
    return "неизвестно"
  }

  if (next > 1e11) {
    return formatDuration(Math.max(1000, next - Date.now()))
  }

  if (next > 1000) {
    return formatDuration(next)
  }

  return formatDuration(next * 1000)
}

function normalizeAgentName(agentName) {
  if (typeof agentName !== "string") {
    return "агент не указан"
  }

  const trimmed = agentName.trim()
  return trimmed || "агент не указан"
}

function normalizePercent(percent) {
  if (typeof percent !== "number" || Number.isNaN(percent)) {
    return undefined
  }

  if (percent < 0 || percent > 100) {
    return undefined
  }

  return Math.round(percent)
}

function summarizeTodos(todos) {
  const list = Array.isArray(todos) ? todos : []
  const pending = list.filter((todo) => todo?.status === "pending").length
  const inProgress = list.filter((todo) => todo?.status === "in_progress").length
  const completed = list.filter((todo) => todo?.status === "completed").length

  return {
    total: list.length,
    pending,
    inProgress,
    completed,
  }
}

function getRemainingSummary(todoSummary) {
  if (!todoSummary || todoSummary.total === 0) {
    return "оценка остатка пока недоступна"
  }

  const remaining = todoSummary.pending + todoSummary.inProgress

  if (remaining <= 0) {
    return "по текущему плану видимых шагов больше не осталось"
  }

  return `по текущему плану осталось ещё ${remaining} ${pluralizeRu(remaining, "шаг", "шага", "шагов")}`
}

function getToolActionSentence(tool) {
  switch (tool) {
    case "read":
      return "Сейчас читает файлы и собирает контекст."
    case "grep":
      return "Сейчас ищет нужные места в коде."
    case "glob":
      return "Сейчас просматривает структуру файлов."
    case "bash":
      return "Сейчас выполняет команду в терминале."
    case "task":
      return "Сейчас делегирует часть работы подагенту."
    case "background_output":
      return "Сейчас забирает результат фоновой задачи, чтобы возобновить работу."
    case "webfetch":
      return "Сейчас читает внешние материалы."
    case "question":
      return "Сейчас готовит уточняющий вопрос."
    case "apply_patch":
      return "Сейчас вносит правки в файлы."
    case "lsp_diagnostics":
      return "Сейчас проверяет диагностику и ошибки."
    case "lsp_find_references":
    case "lsp_goto_definition":
    case "lsp_symbols":
      return "Сейчас разбирает связи в коде."
    default:
      return tool ? `Сейчас работает с инструментом ${tool}.` : "Сейчас выполняет следующий шаг."
  }
}

function getToolAfterSentence(tool) {
  switch (tool) {
    case "task":
      return "Сейчас ждёт результат фоновой задачи от подагента."
    case "background_output":
      return "Сейчас возобновляет работу после ответа подагента."
    case "bash":
    case "read":
    case "grep":
    case "glob":
    case "webfetch":
      return "Сейчас обрабатывает собранный результат."
    case "apply_patch":
      return "Сейчас проверяет внесённые правки."
    default:
      return "Сейчас продолжает выполнение плана."
  }
}

function getPartActionSentence(part) {
  switch (part?.type) {
    case "reasoning":
    case "thinking":
      return "Сейчас обдумывает следующий шаг."
    case "text":
      return "Сейчас формирует ответ."
    case "tool":
    case "tool_use":
      return "Сейчас работает с инструментами."
    case "step-start":
    case "step-finish":
      return "Сейчас продвигается по шагам плана."
    case "message update":
      return "Сейчас обновляет рабочий контекст."
    case "retry":
      return "Сейчас пытается восстановиться после ошибки."
    case "start-work handoff":
      return "Сейчас передаёт план на исполнение Sisyphus."
    case "user prompt":
      return "Сейчас начинает обрабатывать запрос."
    case "subtask":
      return "Сейчас формирует задачу для подагента."
    case "agent":
      return "Сейчас работает через выбранного агента."
    default:
      return "Сейчас выполняет следующий шаг."
  }
}

function getStateLabel(state) {
  switch (state) {
    case "running":
      return "в работе"
    case "waiting_for_subagents":
      return "ждёт подагентов"
    case "retrying":
      return "повторяет попытку"
    case "completed":
      return "завершено"
    case "failed":
      return "остановлено"
    default:
      return "ожидает"
  }
}

function getIndeterminateProgressLabel(state) {
  switch (state.state) {
    case "waiting_for_subagents":
      return "Точный процент пока неизвестен: агент ждёт результат подагента."
    case "retrying":
      return "Точный процент пока неизвестен: идёт повторная попытка после ошибки."
    case "failed":
      return state.hardProviderBlock
        ? "Точный процент недоступен: выполнение упёрлось в блокировку провайдера."
        : "Точный процент недоступен: выполнение остановилось из-за ошибки."
    case "idle":
      return "Точный процент пока неизвестен: агент ждёт новую задачу."
    default:
      return "Точный процент пока неизвестен: текущий этап виден в статусе."
  }
}

function resolveProgress(state) {
  if (state.state === "completed") {
    return {
      kind: "determinate",
      percent: 100,
      source: "terminal",
      label: "Выполнение завершено.",
    }
  }

  const explicitPercent = normalizePercent(state.progressPercent)

  if (explicitPercent !== undefined) {
    return {
      kind: "determinate",
      percent: explicitPercent,
      source: "explicit",
      label: `Получен точный числовой сигнал прогресса: ${explicitPercent}%.`,
    }
  }

  if (state.todoSummary && state.todoSummary.total > 0) {
    return {
      kind: "determinate",
      percent: Math.round((state.todoSummary.completed / state.todoSummary.total) * 100),
      source: "todo",
      label: `Выполнено ${state.todoSummary.completed} из ${state.todoSummary.total} ${pluralizeRu(state.todoSummary.total, "шага", "шагов", "шагов")}.`,
    }
  }

  return {
    kind: "indeterminate",
    source: "none",
    label: getIndeterminateProgressLabel(state),
  }
}

export function createSessionState() {
  return {
    state: "idle",
    agentName: "агент не указан",
    stage: "Ожидает новую задачу.",
    busySince: undefined,
    lastActivityAt: undefined,
    lastToastAt: undefined,
    lastPartType: undefined,
    lastRetrySignature: undefined,
    lastErrorSignature: undefined,
    retry: undefined,
    errorMessage: undefined,
    hardProviderBlock: false,
    todoSummary: undefined,
    progressPercent: undefined,
  }
}

export function buildHeartbeatSnapshot(state, now = Date.now()) {
  const currentState = state ?? createSessionState()
  const progress = resolveProgress(currentState)
  const agentName = normalizeAgentName(currentState.agentName)
  const stage = currentState.stage ?? getPartActionSentence({ type: currentState.lastPartType })
  const statusText = `Агент ${agentName} · ${getStateLabel(currentState.state)} · ${stage}`
  const detailParts = []

  if (currentState.busySince) {
    const elapsed = formatDuration(now - currentState.busySince)

    if (currentState.state === "completed" || currentState.state === "failed") {
      detailParts.push(`Работал ${elapsed}.`)
    } else if (currentState.state !== "idle") {
      detailParts.push(`Уже работает ${elapsed}.`)
    }
  }

  if (progress.kind === "determinate") {
    detailParts.push(`Прогресс ${progress.percent}%. ${progress.label}`)
  } else {
    detailParts.push(`Прогресс без точного процента. ${progress.label}`)
  }

  if (currentState.state === "retrying" && currentState.retry) {
    detailParts.push(`Следующая попытка через ${formatRetryDelay(currentState.retry.next)}.`)
  }

  if (currentState.state === "failed" && currentState.errorMessage) {
    if (currentState.hardProviderBlock) {
      detailParts.push("Продолжение возможно только после исправления настроек провайдера или прокси.")
    } else {
      detailParts.push(`Причина: ${currentState.errorMessage}.`)
    }
  } else if (currentState.state === "running" || currentState.state === "waiting_for_subagents") {
    detailParts.push(getRemainingSummary(currentState.todoSummary))
  }

  return {
    state: currentState.state,
    agentName,
    stage,
    statusText,
    detailText: detailParts.join(" "),
    progress,
    retry: clone(currentState.retry),
    errorMessage: currentState.errorMessage,
    hardProviderBlock: currentState.hardProviderBlock,
    todoSummary: clone(currentState.todoSummary),
  }
}

export function formatHeartbeatStatus(snapshot) {
  return `${snapshot.statusText}. ${snapshot.detailText}`.trim()
}

function getToastTitle(snapshot, reason) {
  switch (reason) {
    case "start_work":
      return "Исполнение запущено"
    case "waiting_for_subagents":
      return "Ожидание подагентов"
    case "resume_from_subagents":
      return "Работа возобновлена"
    case "completed":
      return "Выполнение завершено"
    case "failed":
      return snapshot.hardProviderBlock ? "Блокировка провайдера" : "Выполнение остановлено"
    case "retrying":
      return "Повторная попытка"
    default:
      return "Пульс задачи"
  }
}

function getToastVariant(snapshot) {
  switch (snapshot.state) {
    case "retrying":
      return "warning"
    case "failed":
      return snapshot.hardProviderBlock ? "error" : "warning"
    default:
      return "info"
  }
}

function getToastDuration(reason) {
  switch (reason) {
    case "retrying":
      return RETRY_TOAST_DURATION_MS
    case "failed":
      return ERROR_TOAST_DURATION_MS
    case "heartbeat":
      return HEARTBEAT_TOAST_DURATION_MS
    default:
      return STATE_CHANGE_TOAST_DURATION_MS
  }
}

async function safeToast(client, body) {
  await client?.tui?.showToast?.({ body }).catch(() => {})
}

async function safeLog(client, level, message, extra = {}) {
  await client?.app?.log?.({
    body: {
      service: "heartbeat-status",
      level,
      message,
      extra,
    },
  }).catch(() => {})
}

export function createHeartbeatStatusRuntime({
  client,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let activeSessionID
  const sessions = new Map()

  const getSessionState = (sessionID) => {
    let state = sessions.get(sessionID)

    if (!state) {
      state = createSessionState()
      sessions.set(sessionID, state)
    }

    return state
  }

  const getSessionSnapshot = (sessionID) => buildHeartbeatSnapshot(getSessionState(sessionID), now())

  const markActiveSession = (sessionID) => {
    if (!sessionID) {
      return
    }

    activeSessionID = sessionID
    getSessionState(sessionID)
  }

  const touchState = (sessionID, updates = {}) => {
    const state = getSessionState(sessionID)
    const currentTime = now()

    state.lastActivityAt = currentTime

    if (updates.agentName !== undefined) {
      state.agentName = normalizeAgentName(updates.agentName)
    }

    if (updates.stage !== undefined) {
      state.stage = updates.stage
    }

    if (updates.partType !== undefined) {
      state.lastPartType = updates.partType
    }

    if (updates.state !== undefined) {
      state.state = updates.state
    }

    if (updates.progressPercent !== undefined) {
      state.progressPercent = normalizePercent(updates.progressPercent)
    }

    if (state.state !== "idle") {
      state.busySince ??= currentTime
    }

    if (updates.clearRetry) {
      state.retry = undefined
      state.lastRetrySignature = undefined
    }

    if (updates.clearFailure) {
      state.errorMessage = undefined
      state.hardProviderBlock = false
      state.lastErrorSignature = undefined
    }

    return state
  }

  const publishSnapshot = async (sessionID, reason, level = "info") => {
    if (!sessionID) {
      return undefined
    }

    const snapshot = getSessionSnapshot(sessionID)

    await safeLog(client, level, "Heartbeat state updated", {
      sessionID,
      reason,
      snapshot,
    })

    if (activeSessionID !== sessionID) {
      return snapshot
    }

    await safeToast(client, {
      title: getToastTitle(snapshot, reason),
      message: formatHeartbeatStatus(snapshot),
      variant: getToastVariant(snapshot),
      duration: getToastDuration(reason),
    })

    return snapshot
  }

  const clearSession = (sessionID) => {
    if (!sessionID) {
      return
    }

    sessions.delete(sessionID)

    if (activeSessionID === sessionID) {
      activeSessionID = undefined
    }
  }

  const setRunning = (sessionID, stage, extra = {}) => {
    const state = touchState(sessionID, {
      ...extra,
      state: "running",
      stage,
      clearRetry: true,
      clearFailure: true,
    })

    return state
  }

  const setWaitingForSubagents = (sessionID, stage) => {
    return touchState(sessionID, {
      state: "waiting_for_subagents",
      stage,
      clearRetry: true,
      clearFailure: true,
    })
  }

  const setCompleted = (sessionID) => {
    const state = getSessionState(sessionID)

    if (state.state === "idle") {
      state.stage = "Ожидает новую задачу."
      return state
    }

    return touchState(sessionID, {
      state: "completed",
      stage: "Сейчас завершил текущий этап."
    })
  }

  const setFailed = (sessionID, error) => {
    const hardProviderBlock = isHardProviderBlock(error)
    const errorMessage = extractErrorMessage(error) || "неизвестная ошибка"
    const state = touchState(sessionID, {
      state: "failed",
      stage: hardProviderBlock
        ? "Сейчас упёрся в блокировку провайдера."
        : "Сейчас выполнение остановилось из-за ошибки.",
    })

    state.errorMessage = errorMessage
    state.hardProviderBlock = hardProviderBlock
    state.retry = undefined

    return state
  }

  const heartbeatInterval = setIntervalFn(() => {
    if (!activeSessionID) {
      return
    }

    const state = sessions.get(activeSessionID)

    if (!state || !state.busySince) {
      return
    }

    if (!["running", "waiting_for_subagents", "retrying"].includes(state.state)) {
      return
    }

    const currentTime = now()
    const lastActivityAt = state.lastActivityAt ?? state.busySince

    if (currentTime - lastActivityAt < SILENCE_THRESHOLD_MS) {
      return
    }

    if (state.lastToastAt && currentTime - state.lastToastAt < HEARTBEAT_INTERVAL_MS) {
      return
    }

    state.lastToastAt = currentTime
    void publishSnapshot(activeSessionID, "heartbeat")
  }, HEARTBEAT_INTERVAL_MS)

  return {
    hooks: {
      "chat.message": async (input) => {
        markActiveSession(input.sessionID)
        setRunning(input.sessionID, "Сейчас начинает обрабатывать запрос.", {
          agentName: input.agent,
          partType: "user prompt",
        })
      },

      "command.execute.before": async (input) => {
        markActiveSession(input.sessionID)

        if (input.command.trim().toLowerCase() !== "start-work") {
          return
        }

        setRunning(input.sessionID, "Сейчас передаёт план на исполнение Sisyphus.", {
          partType: "start-work handoff",
        })

        await publishSnapshot(input.sessionID, "start_work")
      },

      "tool.execute.before": async (input) => {
        markActiveSession(input.sessionID)

        if (RESUME_TOOL_NAMES.has(input.tool)) {
          const previousState = getSessionState(input.sessionID).state
          setRunning(input.sessionID, getToolActionSentence(input.tool), {
            partType: "tool_use",
          })

          if (previousState === "waiting_for_subagents") {
            await publishSnapshot(input.sessionID, "resume_from_subagents")
          }

          return
        }

        setRunning(input.sessionID, getToolActionSentence(input.tool), {
          partType: "tool_use",
        })
      },

      "tool.execute.after": async (input) => {
        markActiveSession(input.sessionID)

        if (WAITING_TOOL_NAMES.has(input.tool)) {
          setWaitingForSubagents(input.sessionID, getToolAfterSentence(input.tool))
          await publishSnapshot(input.sessionID, "waiting_for_subagents")
          return
        }

        setRunning(input.sessionID, getToolAfterSentence(input.tool), {
          partType: "tool",
        })
      },

      event: async ({ event }) => {
        if (event.type === "session.deleted") {
          clearSession(event.properties?.info?.id)
          return
        }

        if (event.type === "todo.updated") {
          const sessionID = event.properties?.sessionID

          if (!sessionID) {
            return
          }

          getSessionState(sessionID).todoSummary = summarizeTodos(event.properties?.todos)
          return
        }

        if (event.type === "message.updated") {
          const sessionID = event.properties?.info?.sessionID

          if (!sessionID) {
            return
          }

          setRunning(sessionID, "Сейчас обновляет рабочий контекст.", {
            partType: "message update",
          })
          return
        }

        if (event.type === "message.part.updated") {
          const part = event.properties?.part
          const sessionID = part?.sessionID

          if (!sessionID) {
            return
          }

          setRunning(sessionID, getPartActionSentence(part), {
            partType: part?.type,
            agentName: part?.type === "agent" ? part?.name : undefined,
          })
          return
        }

        if (event.type === "session.status") {
          const sessionID = event.properties?.sessionID
          const status = event.properties?.status

          if (!sessionID || !status) {
            return
          }

          markActiveSession(sessionID)

          if (status.type === "busy") {
            const currentState = getSessionState(sessionID)

            if (currentState.state !== "waiting_for_subagents") {
              setRunning(sessionID, currentState.stage ?? "Сейчас выполняет следующий шаг.", {
                partType: currentState.lastPartType,
              })
            }

            return
          }

          if (status.type === "retry") {
            const state = touchState(sessionID, {
              state: "retrying",
              stage: "Сейчас пытается восстановиться после ошибки.",
              partType: "retry",
            })
            const signature = `${status.attempt}:${status.message}:${status.next}`

            state.retry = {
              attempt: status.attempt,
              message: status.message,
              next: status.next,
            }
            state.errorMessage = status.message
            state.hardProviderBlock = false

            if (state.lastRetrySignature === signature) {
              return
            }

            state.lastRetrySignature = signature
            await publishSnapshot(sessionID, "retrying", "warn")
            return
          }

          setCompleted(sessionID)
          await publishSnapshot(sessionID, "completed")
          return
        }

        if (event.type === "session.idle") {
          const sessionID = event.properties?.sessionID

          if (!sessionID) {
            return
          }

          markActiveSession(sessionID)
          setCompleted(sessionID)
          await publishSnapshot(sessionID, "completed")
          return
        }

        if (event.type !== "session.error") {
          return
        }

        const sessionID = event.properties?.sessionID
        const error = event.properties?.error

        if (!sessionID) {
          return
        }

        markActiveSession(sessionID)

        const state = setFailed(sessionID, error)
        const errorSignature = `${extractStatusCode(error) ?? "na"}:${state.errorMessage}`

        if (state.lastErrorSignature === errorSignature) {
          return
        }

        state.lastErrorSignature = errorSignature
        await publishSnapshot(sessionID, "failed", state.hardProviderBlock ? "error" : "warn")
      },
    },

    getSessionSnapshot,

    getAllSnapshots() {
      return Array.from(sessions.entries()).map(([sessionID]) => ({
        sessionID,
        snapshot: getSessionSnapshot(sessionID),
      }))
    },

    dispose() {
      clearIntervalFn(heartbeatInterval)
    },
  }
}

export const HeartbeatStatusPlugin = async ({ client }) => {
  try {
    globalThis[CLEANUP_KEY]?.()
  } catch {}

  const runtime = createHeartbeatStatusRuntime({ client })
  globalThis[CLEANUP_KEY] = () => runtime.dispose()
  return runtime.hooks
}
