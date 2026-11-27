import { join } from "node:path"

import { readdir, stat } from "../fs/resilient"

// One fail-closed reading of a Linux /proc, shared by the open-fd holder scan and the
// working-directory scan. `holders` is a definite answer; `indeterminate` means a process that
// could matter could not be inspected (counts as held); `unavailable` means this /proc cannot
// answer at all and the caller falls back to another source or fails closed.
export type ProcScan =
  | { readonly kind: "holders"; readonly pids: readonly number[] }
  | { readonly kind: "indeterminate" }
  | { readonly kind: "unavailable" }

export interface ProcView {
  readonly root: string
  readonly selfPid: number
  readonly selfUid: number
}

export function liveProcView(selfUid: number): ProcView {
  return { root: "/proc", selfPid: process.pid, selfUid }
}

export function errnoCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  const code: unknown = error.code
  return typeof code === "string" ? code : undefined
}

// The conservative rule for entries this process cannot read, e.g. another user's processes. A
// SAME-uid process that cannot be inspected (hidepid, SELinux, ptrace_scope) makes the whole scan
// indeterminate -> held, because a same-uid git process is exactly the realistic creator and
// holder of a lock inside this user's memory repo. Another uid's unreadable entry is safe to
// skip: it is the same blind spot non-root lsof has on the same machine (lsof reads the same
// /proc with the same euid), a foreign-uid process cannot have created a lock inside this user's
// memory home (it has no write permission there), and a foreign read-only open survives an unlink
// harmlessly. Parity with the shipped macOS path, never weaker.
export function unreadableFdDirMeansHeld(ownerUid: number, selfUid: number): boolean {
  return ownerUid === selfUid
}

// omo #10199 r5 LOW 4: a /proc directory that exists but lists nothing (present but unmounted in a
// chroot or sandbox) or that does not list THIS process is not a process table, so it can never
// prove "no holders".
export async function listProcPids(view: ProcView): Promise<readonly number[] | null> {
  const entries = await readdir(view.root).catch(() => undefined)
  if (entries === undefined || !entries.includes(String(view.selfPid))) return null
  return entries.filter((entry) => /^\d+$/.test(entry)).map((entry) => Number.parseInt(entry, 10))
}

export type EntryVerdict = "match" | "no-match" | "gone" | "indeterminate"

export async function classifyEntryError(view: ProcView, pid: number, error: unknown): Promise<EntryVerdict> {
  const code = errnoCode(error)
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ESRCH") return "gone"
  if (code === "EACCES" || code === "EPERM") {
    const owner = await stat(join(view.root, String(pid))).catch(() => undefined)
    if (owner === undefined) return "gone"
    return unreadableFdDirMeansHeld(owner.uid, view.selfUid) ? "indeterminate" : "gone"
  }
  return "indeterminate"
}

export async function scanEveryProcess(
  view: ProcView,
  inspect: (pid: number) => Promise<EntryVerdict>,
): Promise<ProcScan> {
  const pids = await listProcPids(view)
  if (pids === null) return { kind: "unavailable" }
  const verdicts = await Promise.all(pids.map(async (pid) => ({ pid, verdict: await inspect(pid) })))
  if (verdicts.some(({ verdict }) => verdict === "indeterminate")) return { kind: "indeterminate" }
  const holders = verdicts.filter(({ verdict }) => verdict === "match").map(({ pid }) => pid)
  return { kind: "holders", pids: holders.sort((a, b) => a - b) }
}
