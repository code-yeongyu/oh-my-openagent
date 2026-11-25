import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { assembleOmoSdk } from "../assembly"
import { PRINCIPAL_MATRIX, REFUSALS, type OmoPrincipal } from "../contract"
import type { OmoSdkPorts } from "../options"

// Security contract (security design 4, 9): every refused cell the root can decide from its own fixed facts, the
// principal and its root options, is answered at the boundary before any core loads or runs. Cells that depend on a
// call's input or on the resolved leg are the cores' and are not in this table.
type TableScenario = {
  readonly id: string
  readonly row: string
  readonly input: unknown
  readonly principal?: OmoPrincipal
}

const SCENARIOS_DIR = join(import.meta.dir, "../../../../../../script/sdk-parity/scenarios")
const table = new Map<string, TableScenario>(
  readdirSync(SCENARIOS_DIR)
    .filter((name) => name.endsWith(".json"))
    .flatMap(
      (name) =>
        (JSON.parse(readFileSync(join(SCENARIOS_DIR, name), "utf8")) as { scenarios: TableScenario[] }).scenarios,
    )
    .map((scenario) => [scenario.id, scenario]),
)

const boundaryLine = (row: string, slug: string) =>
  PRINCIPAL_MATRIX.find((line) => line.slug === slug && line.rows.includes(row) && line.input === undefined)

const atBoundary = REFUSALS.flatMap((refusal) => {
  const slug = refusal.scenario.slice(refusal.row.length + 1).replace(/-refuses-[a-z]+$/, "")
  const line = boundaryLine(refusal.row, slug)
  return line === undefined ? [] : [{ refusal, line }]
})

function untouchedRoot(principal: OmoPrincipal, root: Readonly<Record<string, unknown>>) {
  const touched: string[] = []
  const loads: string[] = []
  const touch = (port: string) => async (): Promise<never> => {
    touched.push(port)
    throw new Error(`${port} was touched`)
  }
  const ports: OmoSdkPorts = {
    desktopLaunch: () => false,
    credentialStore: { read: touch("credentialStore") },
    session: { accessToken: touch("session"), request: touch("session") },
    deviceServiceStatus: touch("deviceService"),
    signInProcess: touch("process"),
    accountSession: {
      session: {
        logout: touch("accountSession"),
        forget: touch("accountSession"),
        update: touch("accountSession"),
        discard: touch("accountSession"),
      },
      store: { clear: touch("accountSession") },
      deviceService: { forget: touch("accountSession") },
    },
    accountStore: {
      platform: "darwin",
      available: touch("accountStore"),
      status: () => {
        touched.push("accountStore")
        throw new Error("accountStore was touched")
      },
      enable: touch("accountStore"),
      disable: touch("accountStore"),
    },
  }
  const sdk = assembleOmoSdk(
    { ...root, principal, env: { OMO_SERVICE_API_URL: "https://accounts.example.test" }, cwd: "/work", ports },
    {
      cores: {
        diagnostics: async () => {
          loads.push("diagnostics")
          return {}
        },
        install: async () => {
          loads.push("install")
          return {}
        },
      },
    },
  )
  return { sdk, touched, loads }
}

async function answerOf(member: unknown, input: unknown): Promise<unknown> {
  const answer = (member as (input: unknown) => unknown)(input)
  if (typeof answer === "object" && answer !== null && Symbol.asyncIterator in answer) {
    for await (const event of answer as AsyncIterable<{ readonly kind: string; readonly failure?: unknown }>)
      if (event.kind === "end") return { kind: "error", error: event.failure }
  }
  return await answer
}

describe("the root's boundary answers every refused cell it can decide", () => {
  test("#given the matrix #when its boundary cells are collected #then every one has its scenario in the table", () => {
    expect(atBoundary.length).toBeGreaterThan(0)
    expect(
      atBoundary.filter(({ refusal }) => !table.has(refusal.scenario)).map(({ refusal }) => refusal.scenario),
    ).toEqual([])
  })

  for (const { refusal, line } of atBoundary)
    test(`${refusal.scenario}: answers ${refusal.code} before any core loads or any port is touched`, async () => {
      const scenario = table.get(refusal.scenario) as TableScenario
      const principal = (scenario.principal ?? { kind: refusal.principal }) as OmoPrincipal
      const { sdk, touched, loads } = untouchedRoot(principal, line.root ?? {})
      const member = refusal.row.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), sdk)
      const answer = await answerOf(member, scenario.input)
      expect(answer).toMatchObject({ kind: "error", error: { code: refusal.code } })
      expect({ touched, loads }).toEqual({ touched: [], loads: [] })
    })
})
