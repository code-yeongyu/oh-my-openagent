import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import {
  excerptRendererText,
  linesComponent,
  normalizeRendererText,
  renderTaskCallLines,
  renderTaskResultComponent,
  renderTaskResultLines,
  rendererVisibleWidth,
  statusThemeColor,
  taskCallLines,
  taskResultLines,
} from "./renderers"

const ANSI_THEME = {
  fg: (_color: ThemeColor, text: string) => `\u001b[33m${text}\u001b[0m`,
  italic: (text: string) => `\u001b[3m${text}\u001b[0m`,
}

const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

function expectNoTerminalControls(value: string): void {
  expect(value).not.toMatch(TERMINAL_CONTROL_PATTERN)
}

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

  test("#given a category spawn call #when rendered #then its current target prompt and mode stay stable through extraction", () => {
    // given
    const args = { prompt: "inspect task rendering", category: "quick", run_in_background: false }

    // when
    const lines = taskCallLines(args)

    // then
    expect(lines).toEqual(['task category:quick "inspect task rendering" foreground'])
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

  test("#given a long Korean prompt #when excerpted #then truncation backs up to a word boundary", () => {
    // given
    const prompt = "한국어로 긴 작업 지시를 작성하고 여러 줄의 혼합 폭 텍스트를 확인하세요."

    // when
    const [line = ""] = taskCallLines({ prompt, category: "missing-cat", run_in_background: false })

    // then
    expect(line).toContain('"한국어로 긴 작업 지시를..."')
    expect(line).not.toContain("작...")
  })
})

describe("taskResultLines", () => {
  test(" w2batch #given aggregate item details #when rendered #then each item receives its own ordered result line", () => {
    // given
    const details = {
      task_id: "st_batch_1",
      status: "error",
      mode: "spawn" as const,
      items: [
        { task_id: "st_batch_1", name: "alpha", status: "completed" },
        { task_id: "", name: "beta", status: "error", error_message: "depth limit" },
        { task_id: "st_batch_3", name: "gamma", status: "pending", queue_position: 2 },
      ],
    }

    // when
    const lines = taskResultLines(details)

    // then
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain("alpha")
    expect(lines[1]).toContain("completed")
    expect(lines[2]).toContain("beta")
    expect(lines[2]).toContain("depth limit")
    expect(lines[3]).toContain("gamma")
    expect(lines[3]).toContain("queue:2")
  })

  test("#given a result detail #when rendered #then task_id and status appear", () => {
    // when
    const lines = taskResultLines({ task_id: "st_0000000b", status: "completed", mode: "spawn" })

    // then
    expect(lines.join(" ")).toContain("st_0000000b")
    expect(lines.join(" ")).toContain("completed")
  })

  test("#given resolved category metadata #when rendered #then target, provider, display, nonduplicate reasoning, mode, status, id, and queue context appear", () => {
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
    expect(row).toContain("category:ultrabrain (openai GPT-5.6 Sol reasoning:xhigh)")
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

  test("#given a persisted display already prefixed by the provider #when full and compact rows render #then the provider is not duplicated", () => {
    // given
    const details = {
      task_id: "st_0000000e",
      status: "pending",
      mode: "spawn" as const,
      category: "ultrabrain",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "OpenAI GPT-5.6 SOL",
        reasoning_effort: "xhigh",
        source: "category" as const,
      },
      run_in_background: true,
    }

    // when
    const plain = taskResultLines(details).join(" ")
    const compact = renderTaskResultComponent(details, ANSI_THEME).render(96).join(" ")

    // then
    expect(plain).toContain("(OpenAI GPT-5.6 SOL reasoning:xhigh)")
    expect(compact).toContain("(OpenAI GPT-5.6 SOL xhigh)")
  })

  test("#given resolved category context #when the real result component renders at width 72 #then provider, friendly model, and reasoning stay visible within bounds", () => {
    // given
    const details = {
      task_id: "st_0000000e",
      status: "pending",
      mode: "spawn" as const,
      category: "ultrabrain",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "GPT-5.6 Sol",
        reasoning_effort: "xhigh",
        source: "category" as const,
      },
      run_in_background: true,
      queue_position: 12,
      reason: "긴 대기열 사유입니다. Provider capacity is constrained for this request.",
    }

    // when
    const rendered = renderTaskResultComponent(details, ANSI_THEME).render(72)

    // then
    expect(rendered.join(" ")).toContain("(openai GPT-5.6 Sol xhigh)")
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
    expectNoTerminalControls(excerpt)
    expect(rendererVisibleWidth(excerpt)).toBeLessThanOrEqual(72)
  })

  test("#given adversarial terminal sequences and Korean whitespace #when normalized #then controls are removed without damaging ordinary text", () => {
    // given
    const cases = [
      { value: "앞 \u001b[31m빨강\u001b[0m 뒤", expected: "앞 빨강 뒤" },
      { value: "앞 \u001b]8;;https://example.com\u0007링크\u001b]8;;\u0007 뒤", expected: "앞 링크 뒤" },
      { value: "한\u001b]0;창 제목\u001b\\글", expected: "한글" },
      { value: "한\u0007글", expected: "한글" },
      { value: "한\u001b[2J글", expected: "한글" },
      { value: "한\u001bc글", expected: "한글" },
      { value: "한\u007f\u0085글", expected: "한글" },
      { value: "안전\u001b]8;;https://example.com/숨김", expected: "안전" },
      { value: "  첫째\t둘째\n界  ", expected: "첫째 둘째 界" },
    ] as const

    // when
    const normalized = cases.map(({ value }) => normalizeRendererText(value))

    // then
    expect(normalized).toEqual(cases.map(({ expected }) => expected))
    for (const value of normalized) expectNoTerminalControls(value)
  })

  test("#given injected ANSI in task call and result fields #when themed #then injected controls are removed while trusted theme ANSI remains", () => {
    // given
    const callArgs = {
      prompt: "검토 \u001b[31m빨강\u001b[0m 완료",
      category: "quick\u001b[2J",
      run_in_background: false,
    }
    const resultDetails = {
      task_id: "st_\u001b]8;;https://example.com\u0007링크\u001b]8;;\u0007",
      status: "completed\u0007",
      mode: "spawn" as const,
      reason: "정상\u007f 종료",
      run_in_background: true,
    }

    // when
    const call = renderTaskCallLines(callArgs, ANSI_THEME).join(" ")
    const result = renderTaskResultLines(resultDetails, ANSI_THEME).join(" ")
    const plain = [...taskCallLines(callArgs), ...taskResultLines(resultDetails)].join(" ")

    // then
    expect(call).toContain("\u001b[3mforeground\u001b[0m")
    expect(result).toContain("\u001b[3mbackground\u001b[0m")
    expect(call).not.toContain("\u001b[31m")
    expect(call).not.toContain("\u001b[2J")
    expect(result).not.toContain("https://example.com")
    expectNoTerminalControls(plain)
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
