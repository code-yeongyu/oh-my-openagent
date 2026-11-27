import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"

import { connectDeviceService } from "../../../packages/device-service-core/src/index.ts"
import { MAPPING as CLI_MAPPING } from "./drivers/cli.ts"
import { MAPPING as SDK_MAPPING } from "./drivers/sdk.ts"
import { MAPPING as TOOLS_MAPPING } from "./drivers/tools.ts"
import { redact } from "./evidence.ts"
import { OPS, SCENARIO, type Mapping, type Op } from "./scenario.ts"
import { startFakeRelay, type EnginePort, type FakeRelay } from "./world/fake-relay.ts"

const HERE = import.meta.dir
const DRIVERS = {
  sdk: join(HERE, "drivers/sdk.ts"),
  tools: join(HERE, "drivers/tools.ts"),
  cli: join(HERE, "drivers/cli.ts"),
} as const

const specifiers = (source: string): string[] => [
  ...[...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1] ?? ""),
  ...[...source.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1] ?? ""),
]

// Every module a driver reaches, following its relative imports: a driver may reach node built-ins, the scenario table
// and its own driver plumbing, and nothing else. The SDK entry is imported by the path the run hands it, never by name.
const closure = (entry: string): { readonly files: string[]; readonly outside: string[] } => {
  const files: string[] = []
  const outside: string[] = []
  const visit = (file: string): void => {
    if (files.includes(file)) return
    files.push(file)
    for (const specifier of specifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith("node:")) continue
      const target = resolve(dirname(file), specifier)
      const allowed = target === join(HERE, "scenario.ts") || target.startsWith(join(HERE, "drivers") + sep)
      if (!allowed || !specifier.startsWith(".")) outside.push(`${file.slice(HERE.length + 1)} -> ${specifier}`)
      else visit(target)
    }
  }
  visit(entry)
  return { files, outside }
}

describe("each driver reaches only its own surface", () => {
  test.each(Object.entries(DRIVERS))(
    "#given the %s driver #when its import closure is read #then it reaches nothing internal",
    (_name, path) => {
      // given / when
      const { outside } = closure(path)

      // then
      expect(outside).toEqual([])
    },
  )

  test("#given the SDK driver #when read #then it starts no process and imports the entry only by the path it is given", () => {
    // given
    const source = closure(DRIVERS.sdk)
      .files.map((file) => readFileSync(file, "utf8"))
      .join("\n")

    // when / then
    expect(source).not.toMatch(/child_process|Bun\.spawn|\bspawn\(/)
    expect(source).toMatch(/await import\(entry\)/)
  })

  test("#given the CLI and tools drivers #when read #then neither imports a module at run time", () => {
    // given
    const sources = [DRIVERS.cli, DRIVERS.tools].flatMap((path) =>
      closure(path).files.map((file) => readFileSync(file, "utf8")),
    )

    // when / then
    for (const source of sources) expect(source).not.toMatch(/\bimport\(/)
  })
})

describe("the scenario is one table the three drivers share", () => {
  test.each([
    ["sdk", SDK_MAPPING],
    ["tools", TOOLS_MAPPING],
    ["cli", CLI_MAPPING],
  ] as const)(
    "#given the %s driver #when its mapping is read #then every operation is a call or a named slice",
    (_, mapping) => {
      // given
      const rows: [Op, Mapping][] = OPS.map((op) => [op, mapping[op]])

      // when
      const unnamed = rows.filter(([, row]) => row.kind === "unavailable" && row.slice.trim() === "")

      // then
      expect(Object.keys(mapping).toSorted()).toEqual([...OPS].toSorted())
      expect(unnamed).toEqual([])
    },
  )

  test("#given the table #when read #then it opens a thread, steers, interrupts, switches the model with a suffix and closes", () => {
    // given
    const ops = SCENARIO.map((step) => step.op)

    // when / then
    expect(ops[0]).toBe("create")
    expect(ops.at(-1)).toBe("close")
    expect(SCENARIO.some((step) => step.input["delivery"] === "steer")).toBe(true)
    expect(SCENARIO.some((step) => step.op === "interrupt")).toBe(true)
    expect(SCENARIO.find((step) => step.op === "setModel")?.input["model"]).toMatch(/^[^/]+\/[^:]+:[a-z]+$/)
  })
})

describe("evidence is redacted of ids", () => {
  test("#given an answer with session ids, device ids and a scratch path #when redacted #then none of them remains", () => {
    // given
    const raw = JSON.stringify({
      thread: "dev-b-91c2/019a7f3e-5b1c-7d2e-8f00-1234567890ab",
      key: "0bb000014c2f9e7a",
      cwd: "/tmp/x1a-world-abc123/b/project",
    })

    // when
    const out = redact(raw, { roots: ["/tmp/x1a-world-abc123"], devices: { "dev-b-91c2": "<device-b>" } })

    // then
    expect(out).not.toContain("019a7f3e")
    expect(out).not.toContain("dev-b-91c2")
    expect(out).not.toContain("/tmp/x1a-world-abc123")
    expect(out).toContain("<device-b>")
  })
})

describe("the fake relay forwards a record to the other device's engine and answers like the device service", () => {
  let relay: FakeRelay | undefined
  afterEach(async () => {
    await relay?.stop()
    relay = undefined
  })

  const engine = (): EnginePort & { readonly sent: Record<string, unknown>[] } => {
    const sent: Record<string, unknown>[] = []
    return {
      sent,
      endpoint: "x1aBhostEndpointKey000",
      request: async (record) => {
        sent.push(record)
        return {
          type: "response",
          command: String(record["type"]),
          success: true,
          data: { sessionId: "rpc-1", state: { durableSessionId: "d-1" } },
        }
      },
      onFrame: () => () => {},
      sessions: async () => [{ key: "rpc-1", engineId: "d-1", name: "x1a", cwd: "/p", state: "idle" }],
      close: async () => {},
    }
  }

  test("#given an engine port on device B #when an endpoint command is sent through the relay #then the engine gets the record and the reply comes back applied", async () => {
    // given
    const port = engine()
    relay = await startFakeRelay({ here: { id: "dev-a", name: "A" }, peer: { id: "dev-b", name: "B" }, engine: port })
    const service = await connectDeviceService({ version: "5.1.83", stateDir: relay.stateDir })

    // when
    const result = await service.endpointCommand("dev-b", { type: "get_protocol_info" })
    service.close()

    // then
    expect(port.sent.map((record) => record["type"])).toEqual(["get_protocol_info"])
    expect(result.outcome.state).toBe("engine_applied")
    expect(result.response).toMatchObject({ success: true, data: { sessionId: "rpc-1" } })
  })

  test("#given a session device B's engine opened #when the account locates it #then the key names that session", async () => {
    // given
    relay = await startFakeRelay({
      here: { id: "dev-a", name: "A" },
      peer: { id: "dev-b", name: "B" },
      engine: engine(),
    })
    const service = await connectDeviceService({ version: "5.1.83", stateDir: relay.stateDir })
    const opened = await service.endpointCommand("dev-b", { type: "open_session" }, { locate: true })

    // when
    const located = await service.locate("dev-b", "d-1")
    const devices = await service.devices()
    service.close()

    // then
    const key = opened.located?.key ?? ""
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(opened.located?.session).toBe(`dev-b.${key}`)
    expect(located).toEqual({ device: "dev-b", key, session: `dev-b.${key}` })
    expect(devices.map((row) => [row.device, row.online])).toEqual([
      ["dev-a", true],
      ["dev-b", true],
    ])
  })
})
