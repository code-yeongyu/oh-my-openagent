import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { registerSettingsTui } from "./register-settings-tui"

type TestNode = { tag: string; props: Record<string, unknown>; children: unknown[] }

type TestBinding = { key: string; cmd: () => void }

type TestLayer = { mode: string; bindings: TestBinding[] }

type TestPromptProps = {
  onConfirm: (value: string) => void
  onCancel: () => void
}

function collectContents(node: TestNode, out: string[] = []): string[] {
  const content = node.props.content
  if (typeof content === "string") out.push(content)
  for (const child of node.children) {
    if (child !== null && typeof child === "object" && "props" in child) {
      collectContents(child as TestNode, out)
    }
  }
  return out
}

function createHarness() {
  const layers: TestLayer[] = []
  const slashCommands: Array<{ onSelect?: () => void }> = []
  let lastRoot: TestNode | null = null
  let lastPrompt: TestPromptProps | null = null
  const dialogStack = {
    replace: (build: () => TestNode) => {
      lastRoot = build()
    },
    clear: () => undefined,
    setSize: () => undefined,
  }
  const api = unsafeTestValue({
    state: { path: { directory: "/tmp/project" } },
    command: {
      register: (factory: () => Array<{ onSelect?: () => void }>) => {
        slashCommands.push(...factory())
        return () => undefined
      },
    },
    keymap: {
      registerLayer: (layer: TestLayer) => {
        layers.push(layer)
        return () => undefined
      },
    },
    mode: { push: () => () => undefined },
    ui: {
      dialog: dialogStack,
      DialogPrompt: (props: TestPromptProps) => {
        lastPrompt = props
        return { tag: "prompt", props: {}, children: [] }
      },
      DialogConfirm: () => ({ tag: "confirm", props: {}, children: [] }),
      toast: () => undefined,
    },
    theme: {
      current: {
        primary: "#fff",
        accent: "#fff",
        success: "#0f0",
        error: "#f00",
        warning: "#ff0",
        text: "#fff",
        textMuted: "#888",
        borderActive: "#fff",
        borderSubtle: "#444",
      },
    },
    renderer: { height: 40, requestRender: () => undefined },
    lifecycle: { onDispose: () => () => undefined },
  })
  const solid = unsafeTestValue({
    createElement: (tag: string): TestNode => ({ tag, props: {}, children: [] }),
    insert: (node: TestNode, child: unknown) => {
      node.children.push(child)
    },
    setProp: (node: TestNode, name: string, value: unknown) => {
      node.props[name] = value
    },
  })
  return {
    api,
    solid,
    layers,
    slashCommands,
    getRoot: () => lastRoot,
    getPrompt: () => lastPrompt,
  }
}

function bindingFor(layers: TestLayer[], key: string): TestBinding {
  const layer = layers.find((entry) => entry.bindings.some((candidate) => candidate.key === key))
  const binding = layer?.bindings.find((candidate) => candidate.key === key)
  if (binding === undefined) throw new Error(`binding ${key} missing`)
  return binding
}

describe("registerSettingsTui", () => {
  let home: string
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "omo-settings-"))
    mkdirSync(join(home, ".omo"), { recursive: true })
    previousHome = process.env.HOME
    process.env.HOME = home
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  function writeConfig(content: string): void {
    writeFileSync(join(home, ".omo", "omo.jsonc"), content)
  }

  it("#given a boolean set false on disk #when toggled #then the pending edit and apply card render", async () => {
    writeConfig(`{ "catalog": { "enabled": false } }`)
    const harness = createHarness()
    await registerSettingsTui(harness.api, harness.solid)

    harness.slashCommands[0]?.onSelect?.()
    bindingFor(harness.layers, "enter,return").cmd()

    const contents = collectContents(harness.getRoot() as TestNode)
    expect(contents.some((line) => line.includes("apply changes (1)"))).toBe(true)
    expect(contents.some((line) => line.includes("pending: true"))).toBe(true)
  })

  it("#given a pending boolean #when a number prompt is confirmed #then the pending edit survives", async () => {
    writeConfig(`{ "catalog": { "enabled": false }, "local_translator": { "min_length": 20 } }`)
    const harness = createHarness()
    await registerSettingsTui(harness.api, harness.solid)

    harness.slashCommands[0]?.onSelect?.()
    bindingFor(harness.layers, "enter,return").cmd()
    for (let index = 0; index < 4; index += 1) bindingFor(harness.layers, "down").cmd()
    bindingFor(harness.layers, "enter,return").cmd()

    const prompt = harness.getPrompt()
    expect(prompt).not.toBeNull()
    prompt?.onConfirm("30")

    const contents = collectContents(harness.getRoot() as TestNode)
    expect(contents.some((line) => line.includes("apply changes (2)"))).toBe(true)
    expect(contents.some((line) => line.includes("pending: 30"))).toBe(true)
  })
})
