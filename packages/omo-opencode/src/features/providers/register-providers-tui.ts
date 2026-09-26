import type { TuiDialogStack, TuiPluginApi } from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import { readProviderModelsCache } from "../../shared/connected-providers-cache"
import { readProviderHealth } from "../../shared/provider-health"
import {
  isProviderDisabled,
  readProviderToggles,
  setProviderDisabled,
  writeProviderToggles,
} from "../../shared/provider-toggles"
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
import {
  buildProviderCards,
  groupProviderCards,
  providerFilterTexts,
  providerHealthNote,
  type ProviderCard,
} from "./provider-cards"

const CARD_MODE = "omo.tui-card.providers"

type ProviderDialogState<Node> = {
  open: boolean
  popMode: (() => void) | null
  cards: readonly ProviderCard[]
  visible: readonly ProviderCard[]
  filterQuery: string
  nodeRefs: CardListNodeRefs<Node> | null
  focus: FocusList
}

function healthNoteFor(providerID: string): string | undefined {
  return providerHealthNote(readProviderHealth(), providerID, Date.now())
}

function buildCards(): ProviderCard[] {
  return buildProviderCards({
    toggles: readProviderToggles(),
    cache: readProviderModelsCache(),
    healthNote: healthNoteFor,
  })
}

function providersHint(): string {
  return "up/down or j/k move - Enter toggles - Esc clears filter then closes"
}

export async function registerProvidersTui<Node>(
  api: TuiPluginApi,
  solid: SolidRuntime<Node>,
): Promise<void> {
  log("[providers] TUI registration started")

  const dialogStack: TuiDialogStack = api.ui.dialog
  const state: ProviderDialogState<Node> = {
    open: false,
    popMode: null,
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
      title: "Providers",
      hint: providersHint(),
      filterQuery: state.filterQuery,
      footerHint: undefined,
      groups: groupProviderCards(state.visible),
      ghostLine: state.visible.length === 0 ? "no providers yet" : undefined,
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
    state.cards = buildCards()
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
    state.visible = filterCards(state.cards, state.filterQuery, providerFilterTexts)
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
    state.cards = buildCards()
    state.visible = filterCards(state.cards, state.filterQuery, providerFilterTexts)
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
    const toggles = readProviderToggles()
    const disabled = isProviderDisabled(toggles, card.providerID)
    const next = setProviderDisabled(toggles, card.providerID, !disabled)
    writeProviderToggles(next)
    api.ui.toast({
      variant: "info",
      message: `provider ${card.providerID} ${disabled ? "enabled" : "disabled"}`,
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
        title: "Providers",
        value: "omo.providers.slash",
        description: "Enable or disable providers for the catalog and delegation",
        category: "Session",
        enabled: true,
        slash: {
          name: "providers",
          aliases: ["provider-toggles"],
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

  log("[providers] TUI controls registered")
}
