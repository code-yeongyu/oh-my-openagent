import { describe, expect, test } from "bun:test"

import {
  excerptRendererText,
  formatSendMessageSummary,
  linesComponent,
  rendererVisibleWidth,
  statusThemeColor,
  taskCallLines,
  taskResultLines,
} from "./renderers"
import type { StructuredSendMessageSummary } from "./renderers"

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
  test("#given current spawn arguments #when rendered #then the legacy target and mode grammar is preserved", () => {
    // given
    const args = { prompt: "ship it", subagent_type: "atlas", run_in_background: false }

    // when
    const lines = taskCallLines(args)

    // then
    expect(lines).toEqual(["agent:atlas (foreground)"])
  })

  test("#given a spawn call #when rendered #then target and mode are summarized", () => {
    // when
    const lines = taskCallLines({ prompt: "x", category: "quick", run_in_background: true })

    // then
    expect(lines.join(" ")).toContain("quick")
    expect(lines.join(" ")).toContain("background")
  })

  test("#given a spawn call without a target #when rendered #then it falls back to a generic task label", () => {
    // when
    const lines = taskCallLines({ prompt: "more" })

    // then
    expect(lines.join(" ")).toContain("task")
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

describe("renderer grammar", () => {
  test("#given long multiline Korean and English text #when excerpted at width 72 #then whitespace is normalized and terminal width is bounded", () => {
    // given
    const text = [
      "첫 번째 줄은 아주 긴 한국어 설명입니다.",
      "Second line keeps enough English words to prove mixed-width truncation is terminal-aware.",
    ].join("\n")

    // when
    const excerpt = excerptRendererText(text, 72)

    // then
    expect(excerpt).not.toContain("\n")
    expect(excerpt).toContain(" ")
    expect(excerpt).toContain("...")
    expect(rendererVisibleWidth(excerpt)).toBeLessThanOrEqual(72)
  })

  test("#given structured shutdown messages #when summarized #then objects are described without object coercion", () => {
    // given
    const request: StructuredSendMessageSummary = { type: "shutdown_request", reason: "작업 완료\nReady to stop." }
    const rejection: StructuredSendMessageSummary = {
      type: "shutdown_response",
      approve: false,
      reason: "Need final Korean/English pass",
    }

    // when
    const requestSummary = formatSendMessageSummary(request)
    const rejectionSummary = formatSendMessageSummary(rejection)

    // then
    expect(requestSummary).toContain("shutdown request")
    expect(requestSummary).toContain("작업 완료 Ready to stop.")
    expect(rejectionSummary).toContain("shutdown rejected")
    expect(rejectionSummary).toContain("Need final Korean/English pass")
    expect(`${requestSummary} ${rejectionSummary}`).not.toContain("[object Object]")
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

  test("#given long Korean and English lines #when rendered at width 72 #then every row is truncated by visible width", () => {
    // given
    const component = linesComponent([
      "요약: 한국어 텍스트가 길어도 셀 폭 기준으로 잘려야 합니다 and the English suffix should not overflow the terminal row.",
    ])

    // when
    const rendered = component.render(72)

    // then
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toContain("...")
    expect(rendererVisibleWidth(rendered[0])).toBeLessThanOrEqual(72)
  })
})
