// Recall receipts: append-only JSONL audit trail of every recall planning
// pass (queries planned, candidates injected, session and time). Parents are
// created on demand; the file is created owner-private (mode 0o600).

import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export interface RecallReceipt {
  readonly sessionId: string
  readonly at: string
  readonly queries: readonly string[]
  readonly injected: readonly { path: string; score: number }[]
}

export async function appendRecallReceipt(filePath: string, receipt: RecallReceipt): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  await appendFile(filePath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 })
}
