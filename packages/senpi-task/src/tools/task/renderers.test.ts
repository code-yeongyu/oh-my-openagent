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
  test("#given current spawn arguments #when rendered #then the plain row includes task, target, actual prompt, and mode", () => {
    // given
    const args = { prompt: "ship it", subagent_type: "atlas", run_in_background: false }

    // when
    const lines = taskCallLines(args)

    // then
    expect(lines).toEqual(['task agent:atlas "ship it" foreground'])
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

  test("#given a long multiline Korean and English prompt #when rendered #then the actual prompt is normalized and width-safe", () => {
    // given
    const prompt = [
      "실제 프롬프트 첫 줄입니다.",
      "Second line is deliberately long enough to require a concise terminal excerpt.",
    ].join("\n")

    // when
    const [line = ""] = taskCallLines({ prompt, category: "ultrabrain", run_in_background: true })

    // then
    expect(line).toContain("실제 프롬프트")
    expect(line).not.toContain("\n")
    expect(line).toContain("...")
    expect(rendererVisibleWidth(line)).toBeLessThanOrEqual(72)
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

  test("#given resolved category metadata #when rendered #then target, display, nonduplicate reasoning, mode, status, id, and queue context appear", () => {
    // given
    const details = {
      task_id: "st_0000000c",
      status: "pending",
      mode: "spawn" as const,
      category: "ultrabrain",
      model: "openai/gpt-5.6-sol",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "GPT-5.6 Sol",
        variant: "xhigh",
        reasoning_effort: "xhigh",
        source: "category" as const,
      },
      run_in_background: true,
      queue_position: 3,
      reason: "provider capacity",
    }

    // when
    const row = taskResultLines(details).join(" ")

    // then
    expect(row).toContain("category:ultrabrain")
    expect(row).toContain("GPT-5.6 Sol")
    expect(row).toContain("reasoning:xhigh")
    expect(row.match(/xhigh/gu)).toHaveLength(1)
    expect(row).toContain("background")
    expect(row).toContain("pending")
    expect(row).toContain("id:st_0000000c")
    expect(row).toContain("queue:3")
    expect(row).toContain("reason:provider capacity")
  })

  test("#given a legacy explicit model result #when rendered #then raw model fallback is useful without empty labels", () => {
    // when
    const row = taskResultLines({
      task_id: "st_0000000d",
      status: "completed",
      mode: "spawn",
      subagent_type: "oracle",
      model: "openai/manual",
      run_in_background: false,
    }).join(" ")

    // then
    expect(row).toContain("agent:oracle")
    expect(row).toContain("model:openai/manual")
    expect(row).toContain("foreground")
    expect(row).not.toContain("prompt:")
    expect(row).not.toContain("reason:")
    expect(row).not.toContain("[object Object]")
  })

  test("#given long result context #when rendered at width 72 #then every ANSI-aware row is bounded and truncated with an ellipsis", () => {
    // given
    const lines = taskResultLines({
      task_id: "st_0000000e",
      status: "pending",
      mode: "spawn",
      category: "ultrabrain",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "GPT-5.6 Sol Extended Display",
        reasoning_effort: "xhigh",
        source: "category",
      },
      run_in_background: true,
      queue_position: 12,
      reason: "긴 대기열 사유입니다. Provider capacity is constrained for this request.",
    })

    // when
    const rendered = linesComponent(lines).render(72)

    // then
    expect(rendered.some((line) => line.includes("..."))).toBe(true)
    for (const line of rendered) expect(rendererVisibleWidth(line)).toBeLessThanOrEqual(72)
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
