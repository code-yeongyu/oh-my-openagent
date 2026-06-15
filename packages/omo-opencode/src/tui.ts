import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

import { computeView, viewKey } from "./features/tui-sidebar/compute-view"
import { POLL_INTERVAL_MS } from "./features/tui-sidebar/constants"
import { deriveAgents, deriveConfig, deriveJobBoard, deriveLoop, deriveRoster } from "./features/tui-sidebar/derivers"
import type { ViewNode } from "./features/tui-sidebar/element-helpers"
import { readMirror } from "./features/tui-sidebar/mirror-io"
import { buildViewNodes } from "./features/tui-sidebar/render-view"
import type { RosterRow } from "./features/tui-sidebar/state-types"
import type { SidebarView } from "./features/tui-sidebar/state-types"
import { log } from "./shared/logger"

type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (parent: Node, child: Node | string) => unknown
  readonly setProp: (node: Node, name: string, value: unknown) => unknown
}

type SidebarSlotRegistration<Node> = {
  readonly order: number
  readonly slots: {
    readonly sidebar_content: () => Node
  }
}

type RegisterSidebarContentSlotInput<Node> = {
  readonly registerSlot: (registration: SidebarSlotRegistration<Node>) => void
  readonly requestRender: () => void
  readonly renderSidebar: () => Node
}

function registerSidebarContentSlot<Node>({
  registerSlot,
  requestRender,
  renderSidebar,
}: RegisterSidebarContentSlotInput<Node>): void {
  registerSlot({
    order: 900,
    slots: {
      sidebar_content: renderSidebar,
    },
  })
  requestRender()
}

function materialize<Node>(nodes: readonly ViewNode[], solid: SolidRuntime<Node>): Node {
  const root = solid.createElement("box")
  solid.setProp(root, "flexDirection", "column")
  for (const node of nodes) {
    solid.insert(root, materializeNode(node, solid))
  }
  return root
}

function materializeNode<Node>(node: ViewNode, solid: SolidRuntime<Node>): Node {
  const element = solid.createElement(node.kind)
  for (const [name, value] of Object.entries(node.props)) {
    solid.setProp(element, name, value)
  }
  if (node.kind === "text") {
    solid.insert(element, node.text ?? "")
  }
  for (const child of node.children ?? []) {
    solid.insert(element, materializeNode(child, solid))
  }
  return element
}

type RosterResolver = (directory: string) => RosterRow[]
type PluginValidation = {
  readonly valid: boolean
  readonly messages: readonly string[]
  readonly config: {
    readonly tui?: {
      readonly sidebar?: {
        readonly enabled?: boolean
      }
    }
  }
}

async function loadPluginValidation(directory: string): Promise<PluginValidation> {
  const { validatePluginConfig } = await import("./config/validate")
  return validatePluginConfig(directory)
}

async function loadRosterRows(directory: string): Promise<readonly RosterRow[]> {
  const { resolveRoster } = await import("./features/tui-sidebar/roster-resolver")
  const resolver: RosterResolver = resolveRoster
  return resolver(directory)
}

async function readView(directory: string): Promise<SidebarView> {
  const validation = await loadPluginValidation(directory)
  const mirror = readMirror(directory)
  const roster = await loadRosterRows(directory)
  return computeView({
    config: deriveConfig(validation),
    roster: deriveRoster(roster),
    agents: deriveAgents(mirror),
    jobs: deriveJobBoard(mirror),
    loop: deriveLoop(mirror),
  })
}

export function handleTuiPollError(
  error: unknown,
  reportPollError: (error: Error) => void = (pollError) => log("[tui-sidebar] polling failed", { error: pollError }),
): void {
  if (error instanceof Error) {
    reportPollError(error)
    return
  }
  throw error
}

const module: TuiPluginModule = {
  id: "oh-my-openagent:tui",
  tui: async (api) => {
    const solid = await import("@opentui/solid").catch(() => null)
    if (!solid) {
      return
    }

    const directory = api.state.path.directory
    if ((await loadPluginValidation(directory)).config.tui?.sidebar?.enabled === false) {
      return
    }

    let currentView = await readView(directory)
    let currentKey = viewKey(currentView)
    let disposed = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | null = null

    registerSidebarContentSlot({
      registerSlot: (registration) => {
        api.slots.register(registration)
      },
      requestRender: () => {
        api.renderer.requestRender()
      },
      renderSidebar: () => materialize(buildViewNodes(currentView, api.theme.current), solid),
    })

    const schedule = (): void => {
      timer = setTimeout(tick, POLL_INTERVAL_MS)
    }

    const tick = async (): Promise<void> => {
      if (disposed || inFlight) {
        if (!disposed) schedule()
        return
      }
      inFlight = true
      try {
        const nextView = await readView(directory)
        const nextKey = viewKey(nextView)
        if (nextKey !== currentKey) {
          currentView = nextView
          currentKey = nextKey
          api.renderer.requestRender()
        }
      } catch (error) {
        handleTuiPollError(error)
      } finally {
        inFlight = false
        if (!disposed) schedule()
      }
    }

    schedule()
    api.lifecycle.onDispose(() => {
      disposed = true
      if (timer) clearTimeout(timer)
    })
  },
}

export default module
