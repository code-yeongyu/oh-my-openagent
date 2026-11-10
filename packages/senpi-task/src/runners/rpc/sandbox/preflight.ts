import { spawnSync } from "node:child_process"
import { accessSync, appendFileSync, constants, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { join } from "node:path"

import type { DenyLivePlan } from "./plan"
import { wrapDenyLive } from "./wrap"

export type PreflightResult =
  | { readonly ok: true; readonly checks: number }
  | { readonly ok: false; readonly reason: string }

type Check = { readonly id: string; readonly target: string; readonly expectWrite: boolean }

const PROBE_TIMEOUT_MS = 15_000

/**
 * Proves the plan's sandbox denies before any child runs (senpi#6287): one throwaway sentinel per
 * protected root the parent itself can write (the positive control), appended to from inside the
 * same wrapper the child gets. Every denied append must fail and leave the sentinel's bytes
 * unchanged; every writable carve-out must accept a write, so a broken wrapper cannot pass as a deny.
 */
export function preflightDenyLive(plan: DenyLivePlan): PreflightResult {
  const nonce = randomBytes(6).toString("hex")
  const checks: Check[] = []
  const created: string[] = []
  try {
    for (const [index, root] of [...plan.deny, ...plan.reDeny].entries()) {
      if (!isWritableDir(root)) continue
      const sentinel = join(root, `.omo-sandbox-probe-${nonce}-${index}`)
      writeFileSync(sentinel, "sentinel\n", { flag: "wx", mode: 0o600 })
      created.push(sentinel)
      appendFileSync(sentinel, "")
      checks.push({ id: `deny:${root}`, target: sentinel, expectWrite: false })
    }
    if (checks.length === 0) return { ok: false, reason: "no protected root is writable by the parent, so the deny cannot be proven" }
    for (const [index, dir] of plan.allow.entries()) {
      if (!isWritableDir(dir) || plan.deny.some((root) => root === dir)) continue
      const target = join(dir, `.omo-sandbox-probe-${nonce}-w${index}`)
      created.push(target)
      checks.push({ id: `allow:${dir}`, target, expectWrite: true })
    }
    const script = checks.map((check, i) => `printf x >> ${shellQuote(check.target)} 2>/dev/null && echo "${i} ok" || echo "${i} denied"`).join("\n")
    const wrapped = wrapDenyLive(plan, "/bin/sh", ["-c", script])
    const run = spawnSync(wrapped.command, [...wrapped.args], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } })
    if (run.status !== 0) return { ok: false, reason: `the sandbox wrapper failed to run the probe (exit ${run.status ?? run.signal}): ${(run.stderr ?? "").trim().slice(0, 300)}` }
    const lines = new Map((run.stdout ?? "").trim().split("\n").map((line) => {
      const [i, verdict] = line.split(" ")
      return [Number(i), verdict] as const
    }))
    for (const [i, check] of checks.entries()) {
      const verdict = lines.get(i)
      const wrote = verdict === "ok"
      if (verdict === undefined) return { ok: false, reason: `the probe printed nothing for ${check.id}` }
      if (wrote !== check.expectWrite) return { ok: false, reason: `${check.id}: ${wrote ? "a write that must be denied succeeded" : "a write the child needs was denied"}` }
      if (!check.expectWrite && readFileSync(check.target, "utf8") !== "sentinel\n") return { ok: false, reason: `${check.id}: the sentinel changed` }
    }
    return { ok: true, checks: checks.length }
  } catch (error) {
    return { ok: false, reason: `preflight failed: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    for (const path of created) rmSync(path, { force: true })
  }
}

function isWritableDir(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
