import { describe, expect, test } from "bun:test"
import type { ThemeColor } from "@code-yeongyu/senpi"

import { renderMemberScopedTaskSendCall, type ControlRenderTheme } from "./renderers"

const TEST_THEME: ControlRenderTheme = {
  fg: (color: ThemeColor, text: string) => `[${color}]${text}[/${color}]`,
  italic: (text: string) => `<i>${text}</i>`,
}

describe("member-scoped task_send renderer", () => {
  test("#given a member-scoped team message #when its tool call renders #then delivery mode is not displayed", () => {
    const rendered = renderMemberScopedTaskSendCall({ to: "lead", message: "peer update" }, TEST_THEME).render(120)[0] ?? ""

    expect(rendered).not.toContain("deliver:")
    expect(rendered).not.toContain("followUp")
  })
})
