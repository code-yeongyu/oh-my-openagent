import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleOmoSdk } from "../../../packages/omo-senpi/src/components/omo-sdk/assembly"
import type { OmoSdkOptions } from "../../../packages/omo-senpi/src/components/omo-sdk/options"
import type { CoreLoaders } from "../../../packages/omo-senpi/src/components/omo-sdk/root/members"
import type { ScenarioRun, ScenarioSetup } from "../conformance-run"
import type { TableScenario } from "../expectation"
import { loadScenarioTable } from "../scenario-table"
import { accountPorts } from "./account"
import { virtualClock } from "./clock"
import { hostPort } from "./host"
import { type FakeFsPort, type FakeProcessPort, fsPort, processPort } from "./process-fs"
import { createRecorder, type Recorder } from "./recorder"
import { remotePort } from "./remote"
import { deliveryLedger, storePort } from "./store"

// One setup for every slice's scenario drivers: the scenario's fakes over one recorder, and the real omo SDK root built
// over them (assembleOmoSdk, the scenario's principal and root options) in a temp home and agent dir of its own. A
// launcher-side slice plugs its cores through `cores`, which receives the same fakes (process and fs included).
// The runner gives a setup no teardown, so the root owns it: each member call makes the scenario's home before it runs
// and removes it, with the remote fixture, once the call settles (a stream: once it ends). Nothing outlives a call.

export type ScenarioFakes = {
  readonly recorder: Recorder
  readonly home: string
  readonly agentDir: string
  readonly process: FakeProcessPort
  readonly fs: FakeFsPort
}

export type SetupOptions = {
  /** The engine was launched by the desktop app: a fact of the fixture the table states no `given` for yet. */
  readonly desktopLaunch?: boolean
  readonly cores?: (fakes: ScenarioFakes) => CoreLoaders
}

const FIXED_NOW = 1_764_000_000_000
export const FAKE_HOME_PREFIX = "sdk-parity-fakes-"

const isStream = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value

async function* endingWith(stream: AsyncIterable<unknown>, end: () => Promise<void>): AsyncGenerator<unknown> {
  try {
    yield* stream
  } finally {
    await end()
  }
}

function callScoped(target: unknown, begin: () => void, end: () => Promise<void>): unknown {
  if (typeof target !== "object" || target === null) return target
  return new Proxy(target, {
    get: (object, key, receiver) => {
      const value = Reflect.get(object, key, receiver) as unknown
      if (typeof value !== "function") return callScoped(value, begin, end)
      return (...args: unknown[]) => {
        begin()
        let answer: unknown
        try {
          answer = Reflect.apply(value, object, args)
        } catch (error) {
          void end()
          throw error
        }
        if (isStream(answer)) return endingWith(answer, end)
        return Promise.resolve(answer).finally(end)
      }
    },
  })
}

export function scenarioSetup(scenario: TableScenario, options: SetupOptions = {}): ScenarioSetup {
  const clock = virtualClock(FIXED_NOW)
  const recorder = createRecorder(scenario, clock)
  const scenarioRoot = join(tmpdir(), `${FAKE_HOME_PREFIX}${randomUUID()}`)
  const home = join(scenarioRoot, "home")
  const elsewhere = join(scenarioRoot, "elsewhere")
  const agentDir = join(home, ".omo", "agent")
  const remote = remotePort(recorder)
  const deliveries = deliveryLedger(recorder)
  const fakes: ScenarioFakes = {
    recorder,
    home,
    agentDir,
    process: processPort(recorder),
    fs: fsPort(recorder, { home, agentDir }),
  }
  const sdkOptions: OmoSdkOptions = {
    env: { HOME: home, OMO_SERVICE_API_URL: "https://accounts.example.test", OMO_CODING_AGENT_DIR: agentDir },
    cwd: home,
    home,
    agentDir,
    uid: 501,
    user: "parity",
    ...(scenario.principal === undefined ? {} : { principal: scenario.principal as OmoSdkOptions["principal"] }),
    ...(scenario.root as Partial<OmoSdkOptions> | undefined),
    ports: {
      ...accountPorts(recorder, { desktopLaunch: options.desktopLaunch === true }),
      host: hostPort(recorder, { agentDir, cwd: home, elsewhere }, deliveries),
      store: storePort(recorder, clock.now, deliveries),
      remote: remote.remote,
      now: clock.now,
      waitClock: clock,
    },
  }
  const cores = options.cores === undefined ? {} : { cores: options.cores(fakes) }
  const root = assembleOmoSdk(sdkOptions, cores)
  if (recorder.given("session")["closed"] === true) root.close()
  // A step that names its own principal runs on a root built for it over the same ports, so it shares every fake's state
  // (the store's receipt book and deliveries included) with the scenario's other calls.
  const rootAs = (principal: Readonly<Record<string, unknown>>): unknown =>
    callScoped(assembleOmoSdk({ ...sdkOptions, principal: principal as OmoSdkOptions["principal"] }, cores), begin, end)
  const begin = (): void => {
    mkdirSync(agentDir, { recursive: true })
  }
  const end = async (): Promise<void> => {
    rmSync(scenarioRoot, { recursive: true, force: true })
    await remote.dispose()
  }
  return { root: callScoped(root, begin, end), rootAs, calls: recorder.calls, after: clock.after }
}

export function scenarioRuns(
  rows: readonly string[],
  options: Readonly<Record<string, SetupOptions>> = {},
): ScenarioRun[] {
  return loadScenarioTable()
    .flatMap((file) => file.scenarios)
    .filter((scenario) => rows.includes(scenario.row))
    .map((scenario) => ({ scenario, setup: () => scenarioSetup(scenario, options[scenario.id]) }))
}
