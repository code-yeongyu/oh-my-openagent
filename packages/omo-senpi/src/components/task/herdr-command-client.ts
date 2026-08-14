import { randomUUID } from "node:crypto"

import {
  createHerdrTaskLogStore,
  type HerdrTaskLog,
  type HerdrTaskLogStore,
} from "./herdr-task-log"
import {
  HERDR_AGENT_SOURCE,
  HERDR_DISPLAY_SOURCE,
  HERDR_VIEWER_READY,
  isMissingTab,
  oneLine,
  parseCreatedTab,
  parseListedTabs,
  taskAlias,
} from "./herdr-command-protocol"
import { executeHerdrCommand, type ExecuteHerdrCommand } from "./herdr-exec"

export type HerdrTaskPane = {
  readonly tabId: string
  readonly paneId: string
}

export type HerdrReportedTask = {
  readonly paneId: string
  readonly taskId: string
  readonly agentType: string
  readonly title: string
  readonly state: "working" | "idle"
  readonly stateLabel: string
  readonly message: string
  readonly sessionId?: string
  readonly sequence: number
}

export type HerdrTaskClient = {
  createTaskPane(input: {
    readonly workspaceId: string
    readonly cwd: string
    readonly label: string
    readonly taskId: string
  }): Promise<HerdrTaskPane>
  startViewer(paneId: string): Promise<void>
  reportTask(input: HerdrReportedTask): Promise<void>
  writeLine(paneId: string, line: string): Promise<void>
  releaseTask(paneId: string, taskId: string, sequence: number): Promise<void>
  closeTab(tabId: string): Promise<void>
}

type CreateClientOptions = {
  readonly herdrBin: string
  readonly platform: NodeJS.Platform
  readonly execute?: ExecuteHerdrCommand
  readonly logs?: HerdrTaskLogStore
  readonly createOwnershipToken?: () => string
  readonly runtimeBin?: string
}

export function createHerdrCommandClient(options: CreateClientOptions): HerdrTaskClient {
  const run = options.execute ?? executeHerdrCommand
  const logs = options.logs ?? createHerdrTaskLogStore(oneLine)
  const runtimeBin = options.runtimeBin ?? "node"
  const invoke = (args: readonly string[]) => run(options.herdrBin, args)
  const paneLogs = new Map<string, HerdrTaskLog>()
  const tabLogs = new Map<string, HerdrTaskLog>()
  const ownershipToken = options.createOwnershipToken ?? randomUUID

  const reconcileUncertainCreate = async (workspaceId: string, label: string): Promise<void> => {
    const output = await invoke(["tab", "list", "--workspace", workspaceId])
    const tabs = parseListedTabs(output)
    for (const tab of tabs) {
      if (tab.label === label) await invoke(["tab", "close", tab.tab_id])
    }
  }

  return {
    async createTaskPane(input) {
      const log = await logs.create(input.taskId)
      const ownedLabel = `${input.label} [omo:${ownershipToken()}]`
      let created: HerdrTaskPane | undefined
      try {
        const output = await invoke([
          "tab",
          "create",
          "--workspace",
          input.workspaceId,
          "--cwd",
          input.cwd,
          "--label",
          ownedLabel,
          "--env",
          `OMO_HERDR_TASK_LOG=${log.path}`,
          "--no-focus",
        ])
        created = parseCreatedTab(output)
        await invoke(["tab", "rename", created.tabId, input.label])
        paneLogs.set(created.paneId, log)
        tabLogs.set(created.tabId, log)
        return created
      } catch (error) {
        const cleanupErrors: unknown[] = []
        try {
          if (created === undefined) await reconcileUncertainCreate(input.workspaceId, ownedLabel)
          else await invoke(["tab", "close", created.tabId])
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        try {
          await log.remove()
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError([error, ...cleanupErrors], "Herdr task pane creation and cleanup failed")
        }
        throw error
      }
    },

    async startViewer(paneId) {
      const log = paneLogs.get(paneId)
      if (log === undefined) throw new Error(`Missing Herdr task log for pane ${paneId}`)
      await invoke(["pane", "run", paneId, `${runtimeBin} "${log.viewerPath}"`])
      await log.append(HERDR_VIEWER_READY)
      try {
        await invoke(["pane", "wait-output", paneId, "--match", HERDR_VIEWER_READY, "--timeout", "10000"])
      } catch {
        // The Agents row remains useful and navigable if the optional log viewer is delayed.
      }
    },

    async reportTask(input) {
      await invoke([
        "pane",
        "report-agent",
        input.paneId,
        "--source",
        HERDR_AGENT_SOURCE,
        "--agent",
        "omo",
        "--state",
        input.state,
        "--message",
        oneLine(input.message),
        "--seq",
        String(input.sequence),
      ])
      const sessionToken = input.sessionId === undefined ? [] : ["--token", `session=${input.sessionId}`]
      await invoke([
        "pane",
        "report-metadata",
        input.paneId,
        "--source",
        HERDR_DISPLAY_SOURCE,
        "--agent",
        "omo",
        "--applies-to-source",
        HERDR_AGENT_SOURCE,
        "--title",
        oneLine(input.title),
        "--display-agent",
        oneLine(input.agentType),
        "--state-label",
        `${input.state}=${oneLine(input.stateLabel)}`,
        "--token",
        `task=${input.taskId}`,
        ...sessionToken,
        "--seq",
        String(input.sequence),
      ])
      await invoke(["agent", "rename", input.paneId, taskAlias(input.taskId)])
    },

    async writeLine(paneId, line) {
      const log = paneLogs.get(paneId)
      if (log === undefined) throw new Error(`Missing Herdr task log for pane ${paneId}`)
      await log.append(line)
    },

    async releaseTask(paneId, _taskId, sequence) {
      await invoke([
        "pane",
        "release-agent",
        paneId,
        "--source",
        HERDR_AGENT_SOURCE,
        "--agent",
        "omo",
        "--seq",
        String(sequence),
      ])
    },

    async closeTab(tabId) {
      const log = tabLogs.get(tabId)
      let closeError: unknown
      try {
        await invoke(["tab", "close", tabId])
      } catch (error) {
        if (!isMissingTab(error)) closeError = error
      }
      let removeError: unknown
      if (log !== undefined) {
        try {
          await log.remove()
          tabLogs.delete(tabId)
          for (const [paneId, paneLog] of paneLogs) {
            if (paneLog === log) paneLogs.delete(paneId)
          }
        } catch (error) {
          removeError = error
        }
      }
      if (closeError !== undefined && removeError !== undefined) {
        throw new AggregateError([closeError, removeError], "Herdr tab and log cleanup failed")
      }
      if (closeError !== undefined) throw closeError
      if (removeError !== undefined) throw removeError
    },
  }
}
