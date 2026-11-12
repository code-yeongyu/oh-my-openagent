import { join, resolve } from "node:path"

import { FixtureProcess } from "../fixtures/fixture-process.ts"
import type { Task } from "../taskset/tasks.ts"
import type { Action, Cell, Toolkit } from "../vocabulary.ts"
import type { FixtureTarget } from "./legacy-code.ts"
import type { Fixtures } from "./legacy.ts"

const FIXTURES = resolve(import.meta.dir, "../fixtures")
const APP = { app: "Conformance Fixture", title: "Document" }

const LINUX_APPS: Partial<Record<Toolkit, readonly string[]>> = {
  native: ["python3", join(FIXTURES, "native-linux/fixture.py")],
  webview: ["python3", join(FIXTURES, "webview/fixture.py")],
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

/** The Linux fixture apps of row 4: one fresh fixture process per cell or task, so no cell starts from another's state. */
export function linuxFixtures(session: () => string): Fixtures {
  let running: FixtureProcess | undefined
  let reports = 0
  const restart = async (toolkit: Toolkit): Promise<FixtureProcess> => {
    await running?.stop()
    running = undefined
    const command = LINUX_APPS[toolkit]
    if (command === undefined) throw new Error(`no Linux ${toolkit} fixture`)
    running = await FixtureProcess.start(command, join(session(), `fixture-${++reports}.json`), "")
    return running
  }
  const current = (): FixtureProcess => {
    if (running === undefined) throw new Error("no fixture is running")
    return running
  }
  return {
    target: (cell: Cell) =>
      LINUX_APPS[cell.toolkit] === undefined
        ? { unavailable: `no ${cell.toolkit} fixture app is ready on Linux yet (row 4)` }
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
