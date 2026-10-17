import { describe, expect, test } from "bun:test"

import { registerNativeEditionNudgeTui } from "./tui"
import type { NudgeStateStore } from "../../hooks/native-edition-nudge"
import type { NudgeState } from "../../hooks/native-edition-nudge/types"

type Registered = {
  readonly title: string
  readonly value: string
  readonly slash?: { readonly name: string; readonly aliases?: readonly string[] }
  readonly onSelect: () => void
}

type SelectProps = {
  readonly title: string
  readonly options: readonly { readonly title: string; readonly value: string }[]
  readonly onSelect: (option: { value: string }) => void
}

function harness() {
  const writes: NudgeState[] = []
  const store: NudgeStateStore = {
    read: () => "missing",
    write: (state) => {
      writes.push(state)
      return true
    },
    probeWritable: () => true,
  }
  const commands: Registered[] = []
  let rendered: SelectProps | undefined
  let cleared = 0
  const toasts: string[] = []

  const api = {
    command: {
      register: (factory: () => readonly unknown[]) => {
        commands.push(...(factory() as Registered[]))
        return () => undefined
      },
    },
    ui: {
      dialog: {
        replace: (render: () => unknown) => {
          render()
        },
        clear: () => {
          cleared += 1
        },
      },
      DialogSelect: (props: unknown) => {
        rendered = props as SelectProps
        return props
      },
      toast: (input: unknown) => {
        toasts.push((input as { message: string }).message)
      },
    },
  }

  const dispose = registerNativeEditionNudgeTui(api as never, { store })
  return { commands, dispose, toasts, writes, cleared: () => cleared, rendered: () => rendered }
}

describe("the command is reachable the way a user would reach it", () => {
  test("#given the TUI registers #when the palette is read #then one /native command is offered", () => {
    // given / when
    const h = harness()

    // then
    expect(h.commands).toHaveLength(1)
    expect(h.commands[0]?.slash?.name).toBe("native")
    expect(h.commands[0]?.value).toBe("omo.native.nudge")
  })

  test("#given the command #when selected #then it opens a dialog offering all four actions", () => {
    // given
    const h = harness()

    // when
    h.commands[0]?.onSelect()

    // then
    expect(h.rendered()?.options.map((o) => o.value)).toEqual(["install", "guide", "later", "never"])
  })
})

describe("choosing an option closes the dialog and tells the user what happened", () => {
  test("#given the dialog is open #when never is chosen #then the decision is stored, the dialog clears and one toast is shown", () => {
    // given
    const h = harness()
    h.commands[0]?.onSelect()

    // when
    h.rendered()?.onSelect({ value: "never" })

    // then
    expect(h.writes[0]?.decision).toBe("never")
    expect(h.cleared()).toBe(1)
    expect(h.toasts).toHaveLength(1)
  })

  test("#given the dialog is open #when install is chosen #then nothing is recorded, so a failed install cannot silence the nudge", () => {
    // given
    const h = harness()
    h.commands[0]?.onSelect()

    // when
    h.rendered()?.onSelect({ value: "install" })

    // then
    expect(h.writes).toHaveLength(0)
    expect(h.toasts[0]).toContain("install --platform=native")
  })
})
