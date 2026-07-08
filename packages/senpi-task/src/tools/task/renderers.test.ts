import { describe, expect, test } from "bun:test"

import { linesComponent, statusThemeColor, taskCallLines, taskResultLines } from "./renderers"

describe("statusThemeColor", () => {
  test("#given terminal statuses #when mapped #then success/error/warning colors are chosen", () => {
    // then
    expect(statusThemeColor("completed")).toBe("success")
    expect(statusThemeColor("error")).toBe("error")
    expect(statusThemeColor("cancelled")).toBe("warning")
    expect(statusThemeColor("running")).toBe("accent")
    expect(statusThemeColor("lost")).toBe("error")
  })
})

describe("taskCallLines", () => {
  test("#given a spawn call #when rendered #then target and mode are summarized", () => {
    // when
    const lines = taskCallLines({ prompt: "x", category: "quick", run_in_background: true })

    // then
    expect(lines.join(" ")).toContain("quick")
    expect(lines.join(" ")).toContain("background")
  })

  test("#given a continuation call #when rendered #then the task_id is shown", () => {
    // when
    const lines = taskCallLines({ prompt: "more", task_id: "st_0000000a" })

    // then
    expect(lines.join(" ")).toContain("st_0000000a")
  })
})

describe("taskResultLines", () => {
  test("#given a result detail #when rendered #then task_id and status appear", () => {
    // when
    const lines = taskResultLines({ task_id: "st_0000000b", status: "completed", mode: "spawn" })

    // then
    expect(lines.join(" ")).toContain("st_0000000b")
    expect(lines.join(" ")).toContain("completed")
  })
})

describe("linesComponent", () => {
  test("#given lines #when a component is built #then render returns those lines and invalidate is callable", () => {
    // given
    const component = linesComponent(["row one", "row two"])

    // when
    const rendered = component.render(80)
    component.invalidate()

    // then
    expect(rendered).toEqual(["row one", "row two"])
  })
})
