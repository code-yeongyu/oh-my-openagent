import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { createMobius } from "../skills/mobius-loop/scripts/mobius.d.mts"

test("#given the shipped Mobius scripts outside the workspace #when an initiative is started and reopened #then its state survives without workspace dependencies", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "omo-mobius-package-"))
  try {
    const project = join(sandbox, "project")
    const scripts = join(sandbox, "scripts")
    mkdirSync(project)
    cpSync(join(import.meta.dir, "../plugin/skills/mobius-loop/scripts"), scripts, { recursive: true })
    const runtime: { createMobius: typeof createMobius } =
      await import(pathToFileURL(join(scripts, "mobius.mjs")).href)

    const started = await runtime.createMobius({ cwd: project, slug: "diagnosis" })
      .start({ title: "Reduce diagnosis time" })
    expect(started.ok).toBe(true)

    const resumed = await runtime.createMobius({ cwd: project, slug: "diagnosis" }).status()
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) throw new Error(resumed.error.message)
    expect(resumed.result.snapshot.title).toBe("Reduce diagnosis time")
    expect(resumed.result.snapshot.revision).toBe(0)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
