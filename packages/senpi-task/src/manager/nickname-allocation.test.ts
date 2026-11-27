import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNicknameAllocator } from "./nickname-allocation"

const input = {
  set: "moon",
  pool: ["Phobos", "Deimos", "Phobos", "Io"],
  parentSessionId: "parent",
  conversationId: "conversation",
  style: "#" as const,
}

test("independent processes reserve one complete pool before wrapping and share occurrence counts", async () => {
  const home = mkdtempSync(join(tmpdir(), "task-nickname-race-"))
  const modulePath = new URL("./nickname-allocation.ts", import.meta.url).href
  const source = `
    import { createNicknameAllocator } from ${JSON.stringify(modulePath)}
    const allocate = createNicknameAllocator(process.argv[1])
    const input = ${JSON.stringify(input)}
    console.log(await allocate(input))
  `
  const start = async () => {
    const child = Bun.spawn([process.execPath, "-e", source, home], {
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    })
    const [code, label, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`Reservation child exited ${code}: ${stderr}`)
    return label.trim()
  }
  try {
    const first = await Promise.allSettled([start(), start(), start()])
    const labels = first.map((outcome) => {
      if (outcome.status === "rejected") throw outcome.reason
      return outcome.value
    })
    expect(labels.sort()).toEqual(["Deimos", "Io", "Phobos"])
    expect(await start()).toMatch(/^(?:Deimos|Io|Phobos) #2$/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("changed pools have independent cursors but share base counts; separate agent homes share neither", async () => {
  const home = mkdtempSync(join(tmpdir(), "task-nickname-home-"))
  try {
    const allocate = createNicknameAllocator(home)
    const one = { ...input, pool: ["Phobos"] }
    expect(await allocate(one)).toBe("Phobos")
    expect(await allocate({ ...one, set: "other", style: "full" })).toBe("Phobos the Second")
    const changed = { ...one, pool: ["Deimos"] }
    expect(await allocate(changed)).toBe("Deimos")
    expect(await allocate(one)).toBe("Phobos #3")
    expect(await createNicknameAllocator(join(home, "isolated"))(one)).toBe("Phobos")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("corrupt state fails without silently overwriting the existing rotation", async () => {
  const home = mkdtempSync(join(tmpdir(), "task-nickname-corrupt-"))
  try {
    const path = join(home, "task-nicknames.json")
    writeFileSync(path, '{"version":2}')
    await expect(createNicknameAllocator(home)(input)).rejects.toThrow("Invalid task nickname state")
    expect(readFileSync(path, "utf8")).toBe('{"version":2}')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
