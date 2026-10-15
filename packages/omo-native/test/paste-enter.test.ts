import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { engineDependencyDir } from "../bin/lib/engine-dependency.js"
import { heldEnterOrPasteEnd, heldPasteEnd, preparePasteEnter } from "../bin/lib/paste-enter.js"

const senpiRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))))
const installedTui = engineDependencyDir(senpiRoot, "@earendil-works/pi-tui")
if (installedTui === undefined) throw new Error("installed engine has no @earendil-works/pi-tui")
// postinstall may already have prepared the installed engine; the preparation is one replacement.
const upstreamStdinBuffer = readFileSync(join(installedTui, "dist", "stdin-buffer.js"), "utf8")
  .replaceAll(heldEnterOrPasteEnd, "this.holdTrailingNewline(trailing, endsPaste)")

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function engineFixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-paste-enter-"))
  roots.push(root)
  const tuiDist = join(root, "node_modules", "@earendil-works", "pi-tui", "dist")
  cpSync(join(installedTui!, "dist"), tuiDist, { recursive: true })
  writeFileSync(join(tuiDist, "stdin-buffer.js"), upstreamStdinBuffer)
  cpSync(join(installedTui!, "package.json"), join(tuiDist, "..", "package.json"))
  return { root, stdinBuffer: join(tuiDist, "stdin-buffer.js") }
}

type Event = ["data" | "paste", string]

// herdr `pane send-text` + `send-keys enter`: the text in one read, Enter in its own read a few ms later.
async function sendTextThenEnter(stdinBufferPath: string, text: string, gapMs: number) {
  const { StdinBuffer } = await import(`${stdinBufferPath}?v=${Math.random()}`)
  let now = 1000
  const buffer = new StdinBuffer({ timeout: 10, burstWindowMs: 20, now: () => now })
  const events: Event[] = []
  buffer.on("data", (sequence: string) => events.push(["data", sequence]))
  buffer.on("paste", (content: string) => events.push(["paste", content]))
  buffer.process(text)
  now += gapMs
  buffer.process("\r")
  buffer.flush()
  buffer.destroy()
  return events
}

describe("installed StdinBuffer: Enter right after a marker-free multi-line paste", () => {
  test("#given the pinned engine #then it still carries the guard this preparation rewrites", () => {
    expect(upstreamStdinBuffer).toMatch(heldPasteEnd)
  })

  test("#given an unprepared engine #when Enter follows a multi-line send-text within the burst window #then the Enter is swallowed into the paste", async () => {
    const fixture = engineFixture()
    const events = await sendTextThenEnter(fixture.stdinBuffer, "line one\nline two\nline three", 2)
    expect(events).toEqual([["paste", "line one\nline two\nline three"], ["paste", "\r"]])
  })

  for (const gapMs of [0, 2, 19, 25, 300]) {
    test(`#given a prepared engine #when Enter follows a multi-line send-text after ${gapMs}ms #then it submits once`, async () => {
      const fixture = engineFixture()
      expect(preparePasteEnter(fixture.root)).toBe(1)
      const events = await sendTextThenEnter(fixture.stdinBuffer, "line one\nline two\nline three", gapMs)
      expect(events).toEqual([["paste", "line one\nline two\nline three"], ["data", "\r"]])
    })
  }

  test("#given a prepared engine #when a paste is split across reads after a line break #then the break stays inside the paste", async () => {
    const fixture = engineFixture()
    preparePasteEnter(fixture.root)
    const { StdinBuffer } = await import(`${fixture.stdinBuffer}?v=${Math.random()}`)
    let now = 1000
    const buffer = new StdinBuffer({ timeout: 10, burstWindowMs: 20, now: () => now })
    const data: string[] = []
    const pastes: string[] = []
    buffer.on("data", (sequence: string) => data.push(sequence))
    buffer.on("paste", (content: string) => pastes.push(content))
    buffer.process("line1\nline2\n")
    now += 5
    buffer.process("line3\n")
    buffer.flush()
    buffer.destroy()
    expect(data).toEqual(["l", "i", "n", "e", "3"])
    expect(pastes).toEqual(["line1\nline2\n", "\n"])
  })

  test("#given a prepared engine #when preparation runs again #then nothing changes", () => {
    const fixture = engineFixture()
    expect(preparePasteEnter(fixture.root)).toBe(1)
    const once = readFileSync(fixture.stdinBuffer, "utf8")
    expect(preparePasteEnter(fixture.root)).toBe(0)
    expect(readFileSync(fixture.stdinBuffer, "utf8")).toBe(once)
  })

  test("#given the installed engine bundle #then every bundled StdinBuffer copy is rewritten", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-paste-enter-bundle-"))
    roots.push(root)
    cpSync(join(senpiRoot, "dist", "bundle", "chunks"), join(root, "dist", "bundle", "chunks"), {
      recursive: true,
      filter: (path) => !path.endsWith(".js") || readFileSync(path, "utf8").includes("holdTrailingNewline("),
    })
    expect(preparePasteEnter(root)).toBeGreaterThan(0)
    const chunks = join(root, "dist", "bundle", "chunks")
    for (const name of readdirSync(chunks).filter((file) => file.endsWith(".js"))) {
      expect(readFileSync(join(chunks, name), "utf8")).not.toMatch(heldPasteEnd)
    }
  })
})
