import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { TuiDialogStack, TuiPluginApi } from "@opencode-ai/plugin/tui"
import {
  OmoConfigWriteError,
  resolveUserOmoConfigPath,
  updateOmoConfig,
  type OmoConfigEdit,
} from "@oh-my-opencode/omo-config-core"

import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { log } from "../../shared/logger"
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
  addPendingEdit,
  type PendingEdit,
} from "./pending-edits"
import {
  RESTART_FALLBACK_MESSAGE,
  attemptSessionRestart,
} from "./restart-strategy"
import {
  buildSettingsCards,
  groupSettingCards,
  settingsFilterTexts,
  type CurrentValues,
  type SettingsCard,
} from "./settings-cards"
import {
  SETTINGS_DEFINITIONS,
  nextBooleanValue,
  nextEnumValue,
  readCurrentSettingValue,
  readSettingValue,
  settingBaseValue,
  settingId,
  type SettingDefinition,
} from "./settings-definitions"

const CARD_MODE = "omo.tui-card.settings"
const FILTER_GHOST = "no settings match the filter"

type SettingsDialogState<Node> = {
  open: boolean
  popMode: (() => void) | null
  currentValues: CurrentValues
  pendingEdits: readonly PendingEdit[]
  cards: readonly SettingsCard[]
  visible: readonly SettingsCard[]
  filterQuery: string
  nodeRefs: CardListNodeRefs<Node> | null
  focus: FocusList
}

function userConfigPath(): string {
  const jsoncPath = resolveUserOmoConfigPath()
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(dirname(jsoncPath), "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

function readUserConfigValues(): CurrentValues {
  const path = userConfigPath()
  if (!existsSync(path)) return {}
  try {
    const parsed = parseJsoncSafe<Record<string, unknown>>(readFileSync(path, "utf-8"))
    const config = typeof parsed.data === "object" && parsed.data !== null ? parsed.data : {}
    const values: Record<string, unknown> = {}
    for (const definition of SETTINGS_DEFINITIONS) {
      const read = readSettingValue(config, definition.path)
      if (read.present) values[settingId(definition)] = read.value
    }
    return values
  } catch (error) {
    log("[settings] reading user omo.jsonc failed", { error: String(error) })
    return {}
  }
}

function settingsHint(): string {
  return "up/down or j/k move - Enter toggle/cycle/apply - Esc clears filter then closes"
}

export async function registerSettingsTui<Node>(
  api: TuiPluginApi,
  solid: SolidRuntime<Node>,
): Promise<void> {
  log("[settings] TUI registration started")

  const dialogStack: TuiDialogStack = api.ui.dialog
  const state: SettingsDialogState<Node> = {
    open: false,
    popMode: null,
    currentValues: {},
    pendingEdits: [],
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
      title: "Momo settings",
      hint: settingsHint(),
      filterQuery: state.filterQuery,
      footerHint: undefined,
      ghostLine: state.visible.length === 0 ? FILTER_GHOST : undefined,
      groups: groupSettingCards(state.visible),
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

  const rebuildCards = (): void => {
    state.cards = buildSettingsCards(state.currentValues, state.pendingEdits)
    state.visible = filterCards(state.cards, state.filterQuery, settingsFilterTexts)
    state.focus.reseat(state.visible.length)
  }

  const openDialog = (): void => {
    if (state.open) close()
    state.currentValues = readUserConfigValues()
    state.pendingEdits = []
    state.filterQuery = ""
    rebuildCards()
    state.focus = createFocusList(state.visible.length)
    state.open = true
    mountDialog(buildNodeList)
    activateMode()
    requestRender()
  }

  const remountFiltered = (): void => {
    if (!state.open) return
    state.visible = filterCards(state.cards, state.filterQuery, settingsFilterTexts)
    state.focus.reseat(state.visible.length)
    state.focus.reset()
    mountDialog(buildNodeList)
    state.open = true
    activateMode()
    requestRender()
  }

  const refreshCards = (): void => {
    if (!state.open) return
    rebuildCards()
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

  const readCurrent = (
    definition: SettingDefinition,
  ): { readonly present: boolean; readonly value: unknown } =>
    readCurrentSettingValue(state.currentValues, definition)

  const queueEdit = (
    definition: SettingDefinition,
    nextValue: boolean | string | number,
  ): void => {
    const read = readCurrent(definition)
    state.pendingEdits = addPendingEdit(state.pendingEdits, {
      id: settingId(definition),
      path: [...definition.path],
      value: nextValue,
      current: { present: read.present, value: read.value },
      defaultLabel: "(default)",
    })
    refreshCards()
    requestRender()
  }

  const toggleBoolean = (definition: SettingDefinition, pending: unknown): void => {
    const read = readCurrent(definition)
    const base = settingBaseValue(definition, read.present, read.value, pending)
    const asBoolean = typeof base === "boolean" ? base : base === "true"
    queueEdit(definition, nextBooleanValue(asBoolean))
  }

  const cycleEnum = (definition: SettingDefinition, pending: unknown): void => {
    const read = readCurrent(definition)
    const base = String(settingBaseValue(definition, read.present, read.value, pending))
    const next = nextEnumValue(definition, base)
    if (next === undefined) return
    queueEdit(definition, next)
  }

  const openNumberPrompt = (definition: SettingDefinition): void => {
    releaseMode()
    const read = readCurrent(definition)
    const id = settingId(definition)
    const pending = state.pendingEdits.find((edit) => edit.id === id)?.value
    const base = settingBaseValue(definition, read.present, read.value, pending)
    dialogStack.replace(() =>
      api.ui.DialogPrompt({
        title: `set ${definition.label}`,
        placeholder: `${definition.path.join(".")} (number, default ${definition.defaultValue})`,
        value: String(base),
        onConfirm: (value: string) => {
          const parsed = Number(value.trim())
          if (value.trim().length === 0 || !Number.isFinite(parsed)) {
            api.ui.toast({
              variant: "warning",
              message: `"${value}" is not a number; ${definition.path.join(".")} stays unchanged.`,
            })
            refreshCards()
          } else {
            queueEdit(definition, parsed)
          }
        },
        onCancel: () => refreshCards(),
      }),
    )
    requestRender()
  }

  const applyPendingEdits = (): boolean => {
    const edits: OmoConfigEdit[] = state.pendingEdits.map((edit) => ({
      path: [...edit.path],
      value: edit.value,
    }))
    if (edits.length === 0) return true
    try {
      const result = updateOmoConfig({ scope: "user", edits })
      state.pendingEdits = []
      state.currentValues = readUserConfigValues()
      const backupNote = result.backupPath === undefined ? "" : ` (backup: ${result.backupPath})`
      api.ui.toast({
        variant: "success",
        message: `wrote ${edits.length} change(s) to ${result.path}${backupNote}`,
      })
      void attemptSessionRestart(api.keymap).then((action) => {
        if (action.kind === "fallback") {
          api.ui.toast({ variant: "info", message: RESTART_FALLBACK_MESSAGE })
        }
        requestRender()
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      api.ui.toast({ variant: "error", message })
      openDialog()
      return false
    }
  }

  const overlayDone = (): void => {
    state.open = false
    state.nodeRefs = null
    releaseMode()
    dialogStack.clear()
    requestRender()
  }

  const openApplyConfirm = (): void => {
    const count = state.pendingEdits.length
    if (count === 0) return
    releaseMode()
    dialogStack.replace(() =>
      api.ui.DialogConfirm({
        title: `Apply settings changes (${count})`,
        message: `write ${count} change(s) to the user omo.jsonc? (timestamped backup will be created)`,
        onConfirm: () => {
          const ok = applyPendingEdits()
          if (ok) overlayDone()
          requestRender()
        },
        onCancel: () => openDialog(),
      }),
    )
    requestRender()
  }

  const activate = (): void => {
    if (!state.open) return
    const card = state.visible[state.focus.current()]
    if (card === undefined) return
    if (card.settingKind === "apply") {
      openApplyConfirm()
      return
    }
    const definition = SETTINGS_DEFINITIONS.find((entry) => settingId(entry) === card.id)
    if (definition === undefined) return
    const pending = state.pendingEdits.find((edit) => edit.id === card.id)?.value
    if (definition.kind === "boolean") {
      toggleBoolean(definition, pending)
      return
    }
    if (definition.kind === "enum") {
      cycleEnum(definition, pending)
      return
    }
    openNumberPrompt(definition)
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
        title: "Settings",
        value: "omo.settings.slash",
        description: "Edit momo settings in the user omo.jsonc (prompt translator, catalog, delegation, comment checker)",
        category: "Session",
        enabled: true,
        slash: {
          name: "settings",
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

  log("[settings] TUI controls registered")
}
