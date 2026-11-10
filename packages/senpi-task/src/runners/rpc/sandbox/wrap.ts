import { existsSync, mkdirSync } from "node:fs"

import type { DenyLivePlan } from "./plan"

export type WrappedCommand = { readonly command: string; readonly args: readonly string[] }

export function wrapDenyLive(plan: DenyLivePlan, command: string, args: readonly string[]): WrappedCommand {
  mkdirSync(plan.tmpDir, { recursive: true, mode: 0o700 })
  if (plan.platform === "darwin") {
    return { command: plan.backend, args: ["-p", seatbeltProfile(plan), "--", command, ...args] }
  }
  return { command: plan.backend, args: [...bwrapArgs(plan), "--", command, ...args] }
}

// bwrap cannot bind a path that does not exist; an absent protected path has nothing a child could
// overwrite, and Seatbelt (which can rule absent paths) keeps every rule.
export function bwrapArgs(plan: DenyLivePlan): readonly string[] {
  const present = (paths: readonly string[]) => paths.filter((path) => existsSync(path))
  return [
    "--bind", "/", "/",
    "--dev-bind", "/dev", "/dev",
    "--proc", "/proc",
    ...present(plan.deny).flatMap((path) => ["--ro-bind", path, path]),
    ...present(plan.allow).flatMap((path) => ["--bind", path, path]),
    ...present(plan.reDeny).flatMap((path) => ["--ro-bind", path, path]),
    "--chdir", plan.cwd,
  ]
}

export function seatbeltProfile(plan: DenyLivePlan): string {
  const rule = (verb: "allow" | "deny", path: string) =>
    `(${verb} file-write* (literal ${quote(path)}) (subpath ${quote(path)}))`
  return [
    "(version 1)",
    "(allow default)",
    ...plan.deny.map((path) => rule("deny", path)),
    ...plan.allow.map((path) => rule("allow", path)),
    ...plan.reDeny.map((path) => rule("deny", path)),
  ].join("\n")
}

function quote(path: string): string {
  return JSON.stringify(path)
}
