import type { TuiDialogStack, TuiPluginApi } from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import type { BackgroundTaskSnapshot } from "../background-agent/types"
import { POLL_INTERVAL_MS } from "../tui-sidebar/constants"
import {
  appendFilterChar,
  backspaceFilter,
  buildCardListNode,
  createFocusList,
  escFilterAction,
  filterCards,
  registerCardKeymap,
  restyleCard,
  scrollCardIntoView,
  type CardListNodeRefs,
  type CardTheme,
  type FocusList,
  type SolidRuntime,
} from "../tui-card"
import { readMirror } from "../tui-sidebar/mirror-io"
import type { JobRow } from "../tui-sidebar/state-types"
import { buildSubagentTree, flattenSubagentTree, type FlatSubagentNode } from "./build-subagent-tree"
import { collectSubagentRows } from "./collect-subagent-rows"
import { renderPromptDetailDialog } from "./prompt-detail-dialog"
import {
  extractSubagentPrompt,
  extractSubagentPromptFromFetched,
} from "./prompt-reader"
import { buildTaskCards, taskFilterTexts, type TaskCard } from "./task-cards"
import { focusIndexPreservingId, subagentSignature } from "./task-refresh"
import type { SubagentRow } from "./types"

const CARD_MODE = "omo.tui-card.tasks"
const EMPTY_GHOST = "no subagents yet - updates live"
const FILTER_GHOST = "no cards match the filter"

type TaskDialogState<Node> = {
  open: boolean
  popMode: (() => void) | null
  refreshTimer: ReturnType<typeof setTimeout> | null
  signature: string
  lines: readonly FlatSubagentNode[]
  cards: readonly TaskCard[]
  visible: readonly TaskCard[]
  filterQuery: string
  nodeRefs: CardListNodeRefs<Node> | null
  focus: FocusList
}

function jobRowToSnapshot(job: JobRow): BackgroundTaskSnapshot {
  return {
    title: job.title,
    status: job.status,
    toolCalls: job.toolCalls,
    lastTool: job.lastTool,
    agent: job.agent ?? "subagent",
    sessionId: job.sessionId,
    parentSessionId: job.parentSessionId,
    modelID: job.model ?? null,
    promptPreview: job.promptPreview ?? null,
    startedAt: job.startedAt,
  }
}

function tasksHint(): string {
  return "up/down or j/k move - Enter opens prompt detail - Esc clears filter then closes"
}

export async function registerSubagentTreeTui<Node>(
  api: TuiPluginApi,
  solid: SolidRuntime<Node>,
): Promise<void> {
  log("[subagent-tree] TUI registration started")

  const dialogStack: TuiDialogStack = api.ui.dialog
  const state: TaskDialogState<Node> = {
    open: false,
    popMode: null,
    refreshTimer: null,
    signature: "",
    lines: [],
    cards: [],
    visible: [],
    filterQuery: "",
    nodeRefs: null,
    focus: createFocusList(0),
  }

  const theme = (): CardTheme => api.theme.current
  const scrollRows = (): number => {
    const height = api.renderer.height
    const topOffset = Math.floor(height / 4)
    return Math.max(3, height - topOffset - 7)
  }
  const requestRender = (): void => {
    api.renderer.requestRender()
  }

  const releaseMode = (): void => {
    state.popMode?.()
    state.popMode = null
  }

  const suspend = (): void => {
    state.open = false
    releaseMode()
  }

  const stopPolling = (): void => {
    if (state.refreshTimer !== null) {
      clearTimeout(state.refreshTimer)
      state.refreshTimer = null
    }
  }

  const close = (): void => {
    if (!state.open) return
    state.open = false
    releaseMode()
    stopPolling()
    dialogStack.clear()
    requestRender()
  }

  const activateMode = (): void => {
    setTimeout(() => {
      if (!state.open || state.popMode !== null) return
      state.popMode = api.mode.push(CARD_MODE)
    }, 0)
  }

  const mountDialog = (build: () => CardListNodeRefs<Node>): void => {
    dialogStack.replace(
      () => {
        const refs = build()
        state.nodeRefs = refs
        return refs.root
      },
      () => suspend(),
    )
    dialogStack.setSize("xlarge")
  }

  const ghostLine = (): string => {
    if (state.cards.length === 0) return EMPTY_GHOST
    return FILTER_GHOST
  }

  const buildNodeList = (): CardListNodeRefs<Node> =>
    buildCardListNode(solid, {
      title: "Subagents",
      hint: tasksHint(),
      filterQuery: state.filterQuery,
      footerHint: undefined,
      ghostLine: ghostLine(),
      groups: [{ header: undefined, cards: state.visible }],
      focusedIndex: state.focus.current(),
      theme: theme(),
      scrollRows: scrollRows(),
      onCardHover: focusCardAt,
      onCardActivate: activateCardAt,
    })

  const followFocus = (): void => {
    const card = state.visible[state.focus.current()]
    const refs = state.nodeRefs
    if (card === undefined || refs === null) return
    setTimeout(() => {
      if (!state.open) return
      scrollCardIntoView(refs, card.id)
      requestRender()
    }, 0)
  }

  const scheduleRefresh = (): void => {
    if (state.refreshTimer !== null) return
    state.refreshTimer = setTimeout(refreshTick, POLL_INTERVAL_MS)
  }

  const refreshTick = (): void => {
    state.refreshTimer = null
    if (!state.open) return
    const mirror = readMirror(api.state.path.directory)
    if (mirror === null) {
      scheduleRefresh()
      return
    }
    const rows = collectSubagentRows({
      backgroundManager: {
        getTasksSnapshot: () => mirror.jobBoard.map(jobRowToSnapshot),
      },
    })
    const lines = flattenSubagentTree(buildSubagentTree(rows))
    const nextSignature = subagentSignature(lines)
    if (nextSignature !== state.signature) {
      const previousId = state.visible[state.focus.current()]?.id
      state.lines = lines
      state.cards = buildTaskCards(lines)
      state.signature = nextSignature
      state.visible = filterCards(state.cards, state.filterQuery, taskFilterTexts)
      state.focus.reseat(state.visible.length)
      state.focus.seek(focusIndexPreservingId(state.visible, previousId, state.focus.current()))
      mountDialog(buildNodeList)
      state.open = true
      followFocus()
      requestRender()
    }
    scheduleRefresh()
  }

  const openTasksCardDialog = (): void => {
    if (state.open) {
      close()
    }
    const mirror = readMirror(api.state.path.directory)
    if (mirror === null) {
      api.ui.toast({
        variant: "warning",
        message: "No fresh subagent data is available yet.",
      })
      return
    }
    const rows = collectSubagentRows({
      backgroundManager: {
        getTasksSnapshot: () => mirror.jobBoard.map(jobRowToSnapshot),
      },
    })
    const lines = flattenSubagentTree(buildSubagentTree(rows))
    state.lines = lines
    state.cards = buildTaskCards(lines)
    state.signature = subagentSignature(lines)
    state.filterQuery = ""
    state.visible = state.cards
    state.focus = createFocusList(state.visible.length)
    state.open = true
    mountDialog(buildNodeList)
    activateMode()
    scheduleRefresh()
    requestRender()
  }

  const remountFiltered = (): void => {
    if (!state.open) return
    state.visible = filterCards(state.cards, state.filterQuery, taskFilterTexts)
    state.focus.reseat(state.visible.length)
    state.focus.reset()
    mountDialog(buildNodeList)
    state.open = true
    activateMode()
    requestRender()
  }

  const restyleFocus = (previous: number, next: number): void => {
    const refs = state.nodeRefs?.cards
    if (refs === undefined) return
    const previousRef = refs[previous]
    const nextRef = refs[next]
    if (previousRef !== undefined) {
      restyleCard(solid, previousRef, state.visible[previous], false, theme())
    }
    if (nextRef !== undefined) {
      restyleCard(solid, nextRef, state.visible[next], true, theme())
    }
  }

  const focusCardAt = (index: number): void => {
    if (!state.open || state.nodeRefs === null) return
    const previous = state.focus.current()
    if (previous === index) return
    state.focus.seek(index)
    restyleFocus(previous, index)
    followFocus()
    requestRender()
  }

  const moveFocusBy = (delta: number): void => {
    if (!state.open || state.nodeRefs === null) return
    const previous = state.focus.current()
    if (!state.focus.move(delta)) return
    restyleFocus(previous, state.focus.current())
    followFocus()
    requestRender()
  }

  const activate = (): void => {
    if (!state.open) return
    const card = state.visible[state.focus.current()]
    if (card === undefined) return
    if (card.row.sessionId === null) {
      return
    }
    void openPromptDetail(card.row, openTasksCardDialog)
  }

  const activateCardAt = (index: number): void => {
    if (!state.open) return
    if (api.renderer.getSelection()?.getSelectedText()) return
    state.focus.seek(index)
    activate()
  }

  const handleFilterChar = (char: string): void => {
    if (!state.open) return
    state.filterQuery = appendFilterChar(state.filterQuery, char)
    remountFiltered()
  }

  const handleFilterBackspace = (): void => {
    if (!state.open) return
    state.filterQuery = backspaceFilter(state.filterQuery)
    remountFiltered()
  }

  const handleClose = (): void => {
    if (!state.open) return
    if (escFilterAction(state.filterQuery) === "clear") {
      state.filterQuery = ""
      remountFiltered()
      return
    }
    close()
  }

  const keymapLayer = registerCardKeymap(api, CARD_MODE, {
    onMoveUp: () => moveFocusBy(-1),
    onMoveDown: () => moveFocusBy(1),
    onActivate: activate,
    onClose: handleClose,
    onFilterChar: handleFilterChar,
    onFilterBackspace: handleFilterBackspace,
  })

  const unregisterSlashCommand =
    api.command?.register(() => [
      {
        title: "Subagent tasks",
        value: "omo.subagent-tree.slash",
        description: "Show running and queued subagents with model, task, and parent tree",
        category: "Session",
        enabled: true,
        slash: {
          name: "tasks",
          aliases: ["agents", "subagents"],
        },
        onSelect: () => openTasksCardDialog(),
      },
    ]) ?? (() => undefined)

  api.lifecycle.onDispose(() => {
    unregisterSlashCommand()
    keymapLayer.unregister()
    stopPolling()
    if (state.open) {
      suspend()
    }
  })

  log("[subagent-tree] TUI controls registered")

  async function openPromptDetail(
    row: SubagentRow,
    reopenTasks: () => void,
  ): Promise<void> {
    const sessionId = row.sessionId
    if (sessionId === null) {
      return
    }
    const syncPrompt = extractSubagentPrompt(
      api.state.session.messages(sessionId),
      (messageID) => api.state.part(messageID),
    )
    if (syncPrompt !== null) {
      renderPromptDetailDialog(api, dialogStack, row, syncPrompt, reopenTasks)
      requestRender()
      return
    }
    let fetchedPrompt: string | null = null
    try {
      const response = await api.client.session.messages({
        sessionID: sessionId,
        directory: api.state.path.directory,
      })
      const messages = response.data ?? []
      fetchedPrompt = extractSubagentPromptFromFetched(messages)
    } catch (error) {
      log("[subagent-tree] on-demand prompt fetch failed", { error: String(error) })
    }
    renderPromptDetailDialog(api, dialogStack, row, fetchedPrompt, reopenTasks)
    requestRender()
  }
}
