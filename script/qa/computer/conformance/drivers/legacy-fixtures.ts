import { join, resolve } from "node:path"

import { FixtureProcess } from "../fixtures/fixture-process.ts"
import type { Task } from "../taskset/tasks.ts"
import type { Action, Cell, Toolkit } from "../vocabulary.ts"
import type { FixtureTarget } from "./legacy-code.ts"
import type { Fixtures } from "./legacy.ts"

const FIXTURES = resolve(import.meta.dir, "../fixtures")
const APP = { title: "Conformance Document" }

type Apps = Partial<Record<Toolkit, readonly string[]>>

const LINUX_APPS: Apps = {
  native: ["python3", join(FIXTURES, "native-linux/fixture.py")],
  webview: ["python3", join(FIXTURES, "webview/fixture.py")],
}

// The workflow fetches the pinned Electron release and builds the Windows app on the runner, then names them here.
function electronApp(env: Readonly<Record<string, string | undefined>>): Apps {
  const binary = env.OMO_CONFORMANCE_ELECTRON?.trim()
  return binary ? { electron: [binary, join(FIXTURES, "electron/main.cjs")] } : {}
}

function appsFor(platform: string, env: Readonly<Record<string, string | undefined>>): Apps | string {
  if (platform === "linux") return { ...LINUX_APPS, ...electronApp(env) }
  if (platform === "darwin") {
    const app = env.OMO_CONFORMANCE_FIXTURE_APP?.trim()
    return app ? { native: [app] } : "OMO_CONFORMANCE_FIXTURE_APP does not name the built macOS fixture app"
  }
  if (platform !== "win32") return `no fixture apps of row 4 are ready on ${platform} yet`
  const exe = env.OMO_CONFORMANCE_FIXTURE_EXE?.trim()
  if (!exe) return "OMO_CONFORMANCE_FIXTURE_EXE does not name the built Windows fixture app"
  const webview = env.OMO_CONFORMANCE_WEBVIEW_EXE?.trim()
  return { native: [exe], ...electronApp(env), ...(webview ? { webview: [webview] } : {}) }
}

// The fixture's accessible names are unique in its window, so elements are found by name alone: a guessed role
// name that the shipped runtime spells differently would be recorded as a driver fault, not as its behaviour.
const TARGETS: Readonly<Record<Action, FixtureTarget>> = {
  click: { ...APP, element: { title: "Press" } },
  "ax.perform": { ...APP, element: { title: "Press" } },
  typeText: { ...APP, element: { title: "Value" } },
  "ax.setValue": { ...APP, element: { title: "Value" } },
  keyChord: { ...APP, element: { title: "Value" } },
  scroll: { ...APP, element: { title: "Scroll target" } },
  drag: { ...APP, element: { title: "b" }, dragTo: { title: "a" } },
  "menu.select": { ...APP, element: { title: "Value" }, menuPath: ["Test", "Conformance"] },
}

// A hosted macOS runner never delivers pid-routed input to a window (measured in #13227), so there a cell that needs a
// pointer or key route would measure the runner, not the release. Only the accessibility routes run; the rest are
// recorded not_run with that reason and send nothing.
const HOSTED_MACOS_ROUTES: ReadonlySet<string> = new Set([
  "ax.setValue/ax",
  "ax.perform/ax",
  "menu.select/ax",
  "typeText/ax",
])

/** Why this host cannot measure a cell, or undefined when it can. */
export function hostScope(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): (cell: Cell) => string | undefined {
  if (platform !== "darwin" || env.OMO_CONFORMANCE_HOSTED_MACOS !== "1") return () => undefined
  return (cell) =>
    HOSTED_MACOS_ROUTES.has(`${cell.action}/${cell.targeting}`)
      ? undefined
      : "pid-routed input unavailable on a hosted runner (#13227)"
}

/** The fixture apps of row 4 on this host: one fresh fixture process per cell or task, so no cell starts from another's state. */
export function hostFixtures(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
  session: () => string,
): { readonly ready: Fixtures } | { readonly unavailable: string } {
  const apps = appsFor(platform, env)
  if (typeof apps === "string") return { unavailable: apps }
  return { ready: fixturesOf(apps, platform, session) }
}

function fixturesOf(apps: Apps, platform: string, session: () => string): Fixtures {
  let running: FixtureProcess | undefined
  let reports = 0
  const restart = async (toolkit: Toolkit): Promise<FixtureProcess> => {
    await running?.stop()
    running = undefined
    const command = apps[toolkit]
    if (command === undefined) throw new Error(`no ${toolkit} fixture on ${platform}`)
    running = await FixtureProcess.start(command, join(session(), `fixture-${++reports}.json`), "")
    return running
  }
  const current = (): FixtureProcess => {
    if (running === undefined) throw new Error("no fixture is running")
    return running
  }
  return {
    target: (cell: Cell) =>
      apps[cell.toolkit] === undefined
        ? { unavailable: `no ${cell.toolkit} fixture app is ready on ${platform} yet (row 4)` }
        : TARGETS[cell.action],
    reset: async (cell) => {
      await restart(cell.toolkit)
    },
    read: async (cell) => current().report().fields[cell.oracle.field],
    resetTask: async (_task: Task) => {
      await restart("native")
    },
    saved: async () => current().report().saved,
    stop: async () => {
      await running?.stop()
      running = undefined
    },
  }
}
