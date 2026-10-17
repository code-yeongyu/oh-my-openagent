import { describe, expect, test } from "bun:test"

import { runDiffCommand, type PanelCommandContext } from "./commands"
import { DIFF_VIEWER_ROW_CAP } from "./constants"
import type { PanelExec } from "./git/read"
import type { PanelGitStatus } from "./sections/files"
import type { PanelPopupFactory } from "./types"

const DIFF = "diff --git a/tracked.txt b/tracked.txt\n@@ -1 +1 @@\n-old\n+new"

const status = (): PanelGitStatus => ({
  root: "/repo",
  files: [
    { xy: " M", path: "tracked.txt", added: 2, removed: 1 },
    { xy: "??", path: "brand-new.txt" },
  ],
})

interface Harness {
  readonly notices: Array<{ message: string; type: string | undefined }>
  readonly selected: string[]
  readonly popupRows: string[][]
  readonly closes: number[]
  run(): Promise<void>
}

function harness(options: {
  status?: () => PanelGitStatus | undefined
  exec?: PanelExec
  choose?: (options: string[]) => string | undefined
  withCustom?: boolean
  noExec?: boolean
  mounted?: boolean
} = {}): Harness {
  const notices: Array<{ message: string; type: string | undefined }> = []
  const selected: string[] = []
  const popupRows: string[][] = []
  const closes: number[] = []
  const exec: PanelExec = options.exec ?? (async () => ({ stdout: DIFF, code: 0 }))
  const deps = {
    status: options.status ?? status,
    exec: options.noExec === true ? undefined : exec,
    mounted: () => options.mounted ?? true,
  }
  const ui = {
    notify(message: string, type?: string) {
      notices.push({ message, type })
    },
    async select(_title: string, choices: string[]) {
      selected.push(...choices)
      return options.choose === undefined ? choices[0] : options.choose(choices)
    },
    ...(options.withCustom === false
      ? {}
      : {
          async custom(factory: PanelPopupFactory) {
            const tui = { terminal: { rows: 50 }, requestRender: () => {} }
            const component = factory(tui, undefined, undefined, () => closes.push(1)) as {
              render(width: number): string[]
              handleInput(data: string): void
            }
            popupRows.push(component.render(60))
            component.handleInput("\x1b")
            return undefined
          },
        }),
  }
  return {
    notices,
    selected,
    popupRows,
    closes,
    run: async () => {
      const handler = (_args: string, ctx: PanelCommandContext): Promise<void> => runDiffCommand(deps, ctx)
      await handler("", { mode: "tui", ui })
    },
  }
}

describe("side panel diff command", () => {
  test("#given changed files #when run #then the selector lists them with their columns and deltas", async () => {
    // given
    const test = harness()

    // when
    await test.run()

    // then
    expect(test.selected).toEqual([" M tracked.txt  +2/-1", "?? brand-new.txt"])
  })

  test("#given a chosen file #when run #then its diff is shown in a framed popup", async () => {
    // given
    const test = harness()

    // when
    await test.run()

    // then
    const painted = test.popupRows[0] ?? []
    expect(painted[0]?.startsWith("┌")).toBe(true)
    expect(painted.some((line) => line.includes("tracked.txt  (diff, read-only)"))).toBe(true)
    expect(painted.some((line) => line.includes("+new"))).toBe(true)
    expect(painted[painted.length - 1]?.startsWith("└")).toBe(true)
  })

  test("#given the popup is open #when escape is pressed #then it closes", async () => {
    // given
    const test = harness()

    // when
    await test.run()

    // then
    expect(test.closes).toEqual([1])
  })

  test("#given a clean working copy #when run #then it says so instead of opening an empty popup", async () => {
    // given
    const test = harness({ status: () => ({ root: "/repo", files: [] }) })

    // when
    await test.run()

    // then
    expect(test.notices).toEqual([{ message: "No changes in the working copy.", type: "info" }])
    expect(test.popupRows).toEqual([])
  })

  test("#given the panel is not mounted in this session #when run #then it says the panel is off", async () => {
    // given
    const test = harness({ mounted: false })

    // when
    await test.run()

    // then
    expect(test.notices).toEqual([{ message: "The side panel is off in this session.", type: "info" }])
    expect(test.popupRows).toEqual([])
  })

  test("#given the selector is dismissed #when run #then nothing is opened", async () => {
    // given
    const test = harness({ choose: () => undefined })

    // when
    await test.run()

    // then
    expect(test.popupRows).toEqual([])
    expect(test.notices).toEqual([])
  })

  test("#given a host without the overlay seam #when run #then the diff is still delivered", async () => {
    // given
    const test = harness({ withCustom: false })

    // when
    await test.run()

    // then
    expect(test.notices[0]?.message).toContain("+new")
  })

  test("#given a host without exec #when run #then it says git cannot be run", async () => {
    // given
    const test = harness({ noExec: true })

    // when
    await test.run()

    // then
    expect(test.notices).toEqual([{ message: "This host exposes no exec, so git cannot be run.", type: "warning" }])
    expect(test.selected).toEqual([])
  })
})

describe("side panel diff command hardening", () => {
  test("#given a file name carrying terminal controls #when the picker lists it #then the label carries none of them", async () => {
    // given: the host's select list folds newlines only
    const test = harness({ status: () => ({ root: "/repo", files: [{ xy: "??", path: "evil\x1b]8;;x\x07\u202ename.txt" }] }) })

    // when
    await test.run()

    // then
    expect(test.selected).toEqual(["?? evil]8;;xname.txt"])
  })

  test("#given a diff longer than the viewer holds #when opened #then it is cut at the cap with the rest counted", async () => {
    // given
    const diff = Array.from({ length: DIFF_VIEWER_ROW_CAP + 3 }, (_, index) => "+line " + index).join("\n")
    const test = harness({ withCustom: false, exec: async () => ({ stdout: diff, code: 0 }) })

    // when
    await test.run()

    // then
    const lines = (test.notices[0]?.message ?? "").split("\n")
    expect(lines.length).toBe(DIFF_VIEWER_ROW_CAP + 1)
    expect(lines[lines.length - 1]).toBe("... 3 more lines")
  })
})
