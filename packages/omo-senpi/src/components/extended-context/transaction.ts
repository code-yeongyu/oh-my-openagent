import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"

import { isPlainRecord, writeFileAtomically } from "@oh-my-opencode/utils"

import {
  modelsJsonPath,
  readModelsJsonConfig,
  readWrittenWindows,
  recordPath,
  writeWrittenWindows,
  type ModelsJson,
  type WrittenWindows,
} from "./store"

const PROVIDER_ID = "chatgpt-subscription"
const TRANSACTION_VERSION = 1

type PendingTransaction = {
  readonly version: typeof TRANSACTION_VERSION
  readonly provider: typeof PROVIDER_ID
  readonly before: string
  readonly after: string
  readonly previous: WrittenWindows
  readonly next: WrittenWindows
}

function transactionPath(agentDir: string): string {
  return join(agentDir, "extended-context.pending.json")
}

function configHash(config: ModelsJson): string {
  const normalized = JSON.stringify(config, (_key, value: unknown) => {
    if (!isPlainRecord(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  })
  return createHash("sha256").update(normalized).digest("hex")
}

function isWindowMap(value: unknown): value is WrittenWindows {
  return isPlainRecord(value) && Object.values(value).every(
    (window) => typeof window === "number" && Number.isSafeInteger(window) && window > 0,
  )
}

async function readTransaction(path: string): Promise<PendingTransaction | undefined> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new Error(`Invalid extended context transaction: ${path}. Review this file and models.json before moving it aside.`, { cause: error })
  }
  if (
    !isPlainRecord(value) || value.version !== TRANSACTION_VERSION || value.provider !== PROVIDER_ID ||
    typeof value.before !== "string" || !/^[a-f0-9]{64}$/.test(value.before) ||
    typeof value.after !== "string" || !/^[a-f0-9]{64}$/.test(value.after) ||
    !isWindowMap(value.previous) || !isWindowMap(value.next)
  ) {
    throw new Error(`Invalid extended context transaction: ${path}. Review this file and models.json before moving it aside.`)
  }
  return {
    version: TRANSACTION_VERSION,
    provider: PROVIDER_ID,
    before: value.before,
    after: value.after,
    previous: value.previous,
    next: value.next,
  }
}

export function beginTransaction(
  agentDir: string,
  before: ModelsJson,
  after: ModelsJson,
  previous: WrittenWindows,
  next: WrittenWindows,
): void {
  const transaction: PendingTransaction = {
    version: TRANSACTION_VERSION,
    provider: PROVIDER_ID,
    before: configHash(before),
    after: configHash(after),
    previous,
    next,
  }
  writeFileAtomically(transactionPath(agentDir), `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 })
}

export async function clearTransaction(agentDir: string): Promise<void> {
  await rm(transactionPath(agentDir), { force: true })
}

export async function recoverTransaction(agentDir: string): Promise<void> {
  const path = transactionPath(agentDir)
  const transaction = await readTransaction(path)
  if (transaction === undefined) return

  const models = modelsJsonPath(agentDir)
  const current = readModelsJsonConfig(models, existsSync(models))
  const written = await readWrittenWindows(recordPath(agentDir))
  if (current.kind === "invalid") {
    throw new Error(`Cannot recover the extended context transaction while ${models} is invalid. Review ${path} and ${models}.`)
  }

  const hash = configHash(current.config)
  if (hash === transaction.before && isDeepStrictEqual(written, transaction.previous)) {
    await clearTransaction(agentDir)
    return
  }
  if (
    hash === transaction.after &&
    (isDeepStrictEqual(written, transaction.previous) || isDeepStrictEqual(written, transaction.next))
  ) {
    if (!isDeepStrictEqual(written, transaction.next)) {
      await writeWrittenWindows(recordPath(agentDir), PROVIDER_ID, transaction.next)
    }
    await clearTransaction(agentDir)
    return
  }
  throw new Error(`Cannot safely recover the extended context transaction because its files changed. Review ${path}, ${models}, and ${recordPath(agentDir)}.`)
}
