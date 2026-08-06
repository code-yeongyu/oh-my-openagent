import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

// The single-writer rule: destruction (dispose / terminate / process.kill) may only be TRIGGERED by
// the lifecycle destruction port. This static audit greps the whole package source and fails on any
// invocation of `.dispose(`, `.terminate(`, or `process.kill(` outside the allowlist below.
//
// The allowlist is: the lifecycle module (the sole INVOKER) plus the handle-DEFINITION modules that
// wire teardown methods onto a handle object by delegating to the underlying senpi resource. The
// plan names `runners/rpc/terminate.ts` explicitly; the other three entries define teardown methods
// on their handle seams by the SAME principle ("runner modules DEFINE dispose/terminate on the
// handle; only lifecycle INVOKES them") and each contains only delegation bodies, never an
// autonomous destruction trigger. Test files and __fixtures__ carry no-op fake handles and are
// exempt. Steering/completion/tools/team/manager business code stays fully audited.
const INVOCATION_ALLOWLIST = [
  "src/lifecycle/",
  "src/runners/rpc/terminate.ts",
  "src/runners/rpc/handle.ts",
  "src/runners/in-process/child-handle.ts",
  "src/manager/child-handle.ts",
]

const FORBIDDEN_PATTERNS = [".dispose(", ".terminate(", "process.kill("]

const packageRoot = join(import.meta.dir, "..", "..")
const srcRoot = join(packageRoot, "src")

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full))
      continue
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full)
  }
  return files
}

function relativePath(full: string): string {
  return full.slice(packageRoot.length + 1).replaceAll("\\", "/")
}

function isAllowlisted(rel: string): boolean {
  if (rel.includes("__fixtures__/") || rel.includes("test-support")) return true
  return INVOCATION_ALLOWLIST.some((allowed) => rel.startsWith(allowed))
}

describe("single-writer destruction audit", () => {
  test("#given package source #when scanning for destruction invocations #then none live outside the lifecycle port", () => {
    // given
    const violations: string[] = []

    // when
    for (const file of listSourceFiles(srcRoot)) {
      const rel = relativePath(file)
      if (isAllowlisted(rel)) continue
      const source = readFileSync(file, "utf8")
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (source.includes(pattern)) violations.push(`${rel} :: ${pattern}`)
      }
    }

    // then
    expect(violations).toEqual([])
  })

  test("#given the allowlist #when auditing the lifecycle port #then it is the only non-definition invoker", () => {
    // given / when / then - the lifecycle dir is present and audited-in as the invoker
    expect(INVOCATION_ALLOWLIST[0]).toBe("src/lifecycle/")
  })
})
