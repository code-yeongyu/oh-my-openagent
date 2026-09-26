import type { TuiDialogStack, TuiPluginApi } from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import {
  isModelAllowed,
  readModelPool,
  toggleModelInPool,
  writeModelPool,
  type ModelPool,
  type ModelPoolEntry,
} from "../../shared/model-pool"
import { readProviderHealth } from "../../shared/provider-health"
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
import { collectPoolCatalogRows, type PoolCatalogRow } from "./pool-catalog-rows"
import {
  buildPoolCards,
  groupPoolCards,
  poolFilterTexts,
  poolProviderHealthNote,
  type PoolCard,
} from "./pool-cards"

const CARD_MODE = "omo.tui-card.pool"
const CLEAR_KEY = "alt+c"

type PoolDialogState<Node> = {
  open: boolean
  popMode: (() => void) | null
  rows: readonly PoolCatalogRow[]
  cards: readonly PoolCard[]
  visible: readonly PoolCard[]
  filterQuery: string
  nodeRefs: CardListNodeRefs<Node> | null
  focus: FocusList
}

function poolAfterToggle(
  pool: ModelPool,
  rows: readonly PoolCatalogRow[],
  providerID: string,
  modelID: string,
): ModelPool {
  if (!isModelAllowed(pool, providerID, modelID)) {
    return toggleModelInPool(pool, providerID, modelID)
  }
  if (pool.allowed.length === 0) {
    // An empty pool allows everything; excluding one model requires
    // materializing the full catalog minus that entry so every other
    // model keeps its allowed state.
    const allowed: ModelPoolEntry[] = rows
      .filter((row) => row.providerID !== providerID || row.modelID !== modelID)
      .map((row) => ({ providerID: row.providerID, modelID: row.modelID }))
    return { version: 1, allowed, updatedAt: new Date().toISOString() }
  }
  return toggleModelInPool(pool, providerID, modelID)
}

function healthNoteFor(providerID: string): string | undefined {
  return poolProviderHealthNote(readProviderHealth(), providerID, Date.now())
}

function buildCards(rows: readonly PoolCatalogRow[]): PoolCard[] {
  return buildPoolCards({ pool: readModelPool(), rows, healthNote: healthNoteFor })
}

function poolHint(): string {
  return "up/down or j/k move - Enter toggle - Esc clears filter then closes"
}

function poolFooterHint(): string {
  return "alt+c clear pool (allow every model)"
}

export async function registerModelPoolTui<Node>(
  api: TuiPluginApi,
  solid: SolidRuntime<Node>,
): Promise<void> {
  log("[model-pool] TUI registration started")

  const dialogStack: TuiDialogStack = api.ui.dialog
  const state: PoolDialogState<Node> = {
    open: false,
    popMode: null,
    rows: [],
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

  const close = (): void => {
    if (!state.open) return
    state.open = false
    releaseMode()
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

  const buildNodeList = (): CardListNodeRefs<Node> =>
    buildCardListNode(solid, {
      title: "Model pool",
      hint: poolHint(),
      filterQuery: state.filterQuery,
      footerHint: poolFooterHint(),
      groups: groupPoolCards(state.visible),
      ghostLine: state.visible.length === 0 ? "no models match the filter" : undefined,
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

  const openDialog = (): void => {
    if (state.open) {
      close()
    }
    const rows = collectPoolCatalogRows()
    if (rows === null) {
      api.ui.toast({
        variant: "warning",
        message: "No provider model catalog is available yet.",
      })
      return
    }
    state.rows = rows
    state.cards = buildCards(rows)
    state.filterQuery = ""
    state.visible = state.cards
    state.focus = createFocusList(state.visible.length)
    state.open = true
    mountDialog(buildNodeList)
    activateMode()
    requestRender()
  }

  const remountFiltered = (): void => {
    if (!state.open) return
    state.visible = filterCards(state.cards, state.filterQuery, poolFilterTexts)
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

  const refreshBadges = (): void => {
    if (!state.open || state.nodeRefs === null) return
    state.cards = buildCards(state.rows)
    state.visible = filterCards(state.cards, state.filterQuery, poolFilterTexts)
    state.focus.reseat(state.visible.length)
    const refs = state.nodeRefs.cards
    for (let index = 0; index < refs.length; index += 1) {
      const card = state.visible[index]
      const ref = refs[index]
      if (card === undefined || ref === undefined) continue
      restyleCard(solid, ref, card, index === state.focus.current(), theme())
    }
  }

  const activate = (): void => {
    if (!state.open) return
    const card = state.visible[state.focus.current()]
    if (card === undefined) return
    const pool = readModelPool()
    const next = poolAfterToggle(pool, state.rows, card.providerID, card.modelID)
    writeModelPool(next)
    const allowed = isModelAllowed(next, card.providerID, card.modelID)
    api.ui.toast({
      variant: "info",
      message: `${card.providerID}/${card.modelID} ${allowed ? "allowed" : "excluded"} in the model pool.`,
    })
    refreshBadges()
    requestRender()
  }

  const activateCardAt = (index: number): void => {
    if (!state.open) return
    if (api.renderer.getSelection()?.getSelectedText()) return
    state.focus.seek(index)
    activate()
  }

  const clearPool = (): void => {
    if (!state.open) return
    writeModelPool({
      version: 1,
      allowed: [],
      updatedAt: new Date().toISOString(),
    })
    api.ui.toast({
      variant: "info",
      message: "Model pool cleared; every model is allowed again.",
    })
    refreshBadges()
    requestRender()
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
    extraBindings: [{ key: CLEAR_KEY, run: clearPool }],
  })

  const unregisterSlashCommand =
    api.command?.register(() => [
      {
        title: "Model pool",
        value: "omo.model-pool.slash",
        description: "Pick which models the momo orchestrator may select",
        category: "Session",
        enabled: true,
        slash: {
          name: "pool",
          aliases: ["models-pool"],
        },
        onSelect: () => openDialog(),
      },
    ]) ?? (() => undefined)

  api.lifecycle.onDispose(() => {
    unregisterSlashCommand()
    keymapLayer.unregister()
    if (state.open) {
      suspend()
    }
  })

  log("[model-pool] TUI controls registered")
}
