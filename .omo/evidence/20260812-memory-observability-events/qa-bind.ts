import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "../../../packages/omo-senpi/src/components/memory/context"
import { MemoryFakeExtensionAPI, loadedMemoryConfig, memorySettings } from "../../../packages/omo-senpi/src/components/memory/memory.test-support"
import { createMemoryWiring } from "../../../packages/omo-senpi/src/components/memory/wiring"
import {
  REFLECTION_COMPLETION_ENTRY_TYPE,
  REFLECTION_SUMMARY_ENTRY_TYPE,
  renderReflectionCompletionEntry,
  type ReflectionCompletionRecord,
} from "../../../packages/omo-senpi/src/components/memory/worker"

const memoryHome = process.env.OMO_MEMORY_HOME ?? await mkdtemp(join(tmpdir(), "omo-memory-observability-"))
const identityPaths = buildIdentityPaths(memoryHome, "qa-identity")
const completionsDir = join(identityPaths.reflection, "completions")
const sessionId = "new-session-not-in-provenance"
const cleanupReceipt: string[] = []

try {
  await mkdir(completionsDir, { recursive: true })
  await mkdir(identityPaths.repo, { recursive: true })
  await writeFile(join(identityPaths.repo, "dirty-untracked.txt"), "dirty worktree probe\n")
  const now = Date.now()
  const records: ReflectionCompletionRecord[] = Array.from({ length: 8 }, (_, index) => ({
    schemaVersion: 1,
    runId: `qa-run-${index}`,
    identity: "qa-identity",
    category: "quick",
    conversationIds: [`past-session-${index}`],
    trigger: "manual",
    outcome: index === 5 ? "failed" : "merged",
    ...(index === 5 ? { reason: "child_exit", detail: "stable qa failure" } : {}),
    startedAt: new Date(now - 10_000).toISOString(),
    finishedAt: new Date(now - (index < 6 ? index * 60_000 : (8 + index) * 24 * 60 * 60_000)).toISOString(),
    delivery: { status: "pending" },
  }))
  for (const record of records) {
    await writeFile(join(completionsDir, `${record.runId}.json`), `${JSON.stringify(record)}\n`)
  }

  const identity = createMemoryIdentityContext({
    identity: "qa-identity",
    identityPaths,
    binding: { identity: "qa-identity", repoPathHash: "qa", boundAt: now },
  })
  const pi = new MemoryFakeExtensionAPI()
  const notifications: Array<{ message: string; level: string }> = []
  const eventCtx = {
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => [],
    },
    ui: {
      setStatus: () => {},
      notify: (message: string, level: string) => notifications.push({ message, level }),
    },
  }
  const runtime = {
    identity,
    store: {
      evaluate: async () => null,
      readState: async () => ({}),
      complete: async () => ({ outcome: "failed" as const }),
    },
    reservationPort: {
      readState: async () => ({}),
      complete: async () => ({ outcome: "failed" as const }),
    },
    runner: { launch: async () => { throw new Error("QA runner should not launch") } },
    launch: () => {},
    reconcile: async () => {},
  }
  const wiring = createMemoryWiring({
    sessions: new Map([[sessionId, { context: identity }]]),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    cwd: () => identityPaths.repo,
    env: { OMO_MEMORY_HOME: memoryHome },
    createRuntime: () => runtime,
  })

  await wiring.afterBind(pi, sessionId, identity, eventCtx)
  const firstEntries = [...pi.entries]
  const firstNotifications = [...notifications]
  await wiring.afterBind(pi, sessionId, identity, eventCtx)

  const detailed = firstEntries.filter((entry) => entry.customType === REFLECTION_COMPLETION_ENTRY_TYPE)
  const summaries = firstEntries.filter((entry) => entry.customType === REFLECTION_SUMMARY_ENTRY_TYPE)
  const persisted = await Promise.all(records.map(async (record) =>
    JSON.parse(await readFile(join(completionsDir, `${record.runId}.json`), "utf8")) as ReflectionCompletionRecord
  ))
  const stale = persisted.filter((record) => Date.parse(record.finishedAt) < now - 7 * 24 * 60 * 60_000)
  const legacy = records[0]
  const legacyRendered = legacy === undefined
    ? undefined
    : renderReflectionCompletionEntry({
        type: "custom",
        id: "legacy-entry",
        parentId: null,
        timestamp: legacy.finishedAt,
        customType: REFLECTION_COMPLETION_ENTRY_TYPE,
        data: legacy,
      }, { expanded: false }, {
        fg: (_color, text) => text,
        bg: (_color, text) => text,
        bold: (text) => text,
        dim: (text) => text,
        italic: (text) => text,
        underline: (text) => text,
        strikethrough: (text) => text,
        inverse: (text) => text,
      })

  const report = {
    sandbox: memoryHome,
    bindSessionId: sessionId,
    provenanceSessionIds: records.flatMap((record) => record.conversationIds),
    dirtyWorktreeProbe: await readFile(join(identityPaths.repo, "dirty-untracked.txt"), "utf8"),
    firstBind: {
      detailedEntries: detailed.length,
      summaryEntries: summaries.length,
      notifications: firstNotifications,
    },
    secondBind: {
      newEntries: pi.entries.length - firstEntries.length,
      newNotifications: notifications.length - firstNotifications.length,
    },
    staleConsumedSilently: stale.length === 2 && stale.every((record) => record.delivery.status === "consumed"),
    allConsumedByNewSession: persisted.every((record) =>
      record.delivery.status === "consumed" && record.delivery.sessionId === sessionId
    ),
    misleadingSuccessOutputProbe: {
      actualUiCallbackCount: notifications.length,
      actualUiCallbackPayload: notifications,
    },
    staleStateProbe: {
      legacyRecordHasDurationMs: legacy !== undefined && "durationMs" in legacy,
      rendererReturnedComponent: legacyRendered !== undefined,
    },
  }

  if (detailed.length !== 5) throw new Error(`expected 5 detailed entries, got ${detailed.length}`)
  if (summaries.length !== 1) throw new Error(`expected 1 summary, got ${summaries.length}`)
  if (firstNotifications.length !== 1) throw new Error(`expected 1 actual UI callback, got ${firstNotifications.length}`)
  if (pi.entries.length !== firstEntries.length || notifications.length !== firstNotifications.length) {
    throw new Error("second bind was not idempotent")
  }
  if (!report.staleConsumedSilently || !report.allConsumedByNewSession) throw new Error("delivery persistence assertion failed")
  if (!report.staleStateProbe.rendererReturnedComponent) throw new Error("legacy record did not render")

  console.log(JSON.stringify(report, null, 2))
} finally {
  await rm(memoryHome, { recursive: true, force: true })
  cleanupReceipt.push(`removed sandbox ${memoryHome}`)
  console.error(JSON.stringify({ cleanupReceipt }))
}
