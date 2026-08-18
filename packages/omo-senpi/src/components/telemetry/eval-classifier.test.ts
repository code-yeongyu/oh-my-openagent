import { describe, expect, test } from "bun:test"

import {
  classifyWaveBucket,
  isEvalToolName,
  summarizeWaveBuckets,
  type ClassifiableWave,
} from "./eval-classifier"

function wave(toolNames: readonly string[], durationMs = 1_000): ClassifiableWave {
  return { toolNames, spanMs: durationMs }
}

describe("eval tool bucket classification", () => {
  test("#given a wave with no eval calls #when classified #then it lands in non_eval", () => {
    expect(classifyWaveBucket(wave(["bash", "read", "grep"]))).toBe("non_eval")
  })

  test("#given a wave of only eval calls #when classified #then it lands in eval_only", () => {
    expect(classifyWaveBucket(wave(["eval"]))).toBe("eval_only")
    expect(classifyWaveBucket(wave(["eval", "eval"]))).toBe("eval_only")
  })

  test("#given a wave with both eval and non-eval calls #when classified #then it lands in mixed", () => {
    expect(classifyWaveBucket(wave(["bash", "eval"]))).toBe("mixed")
  })

  test("#given eval naming variants #when detected #then only true eval names match", () => {
    for (const name of ["eval", "codemode", "mcp:eval", "code-mode", "EVAL", " eval ", "server/eval", "tool_eval", "code_mode"]) {
      expect(isEvalToolName(name)).toBe(true)
    }
    for (const name of ["evaluate_foo", "evaluate", "ln", "bash", "read", "codemodel", "eval_helper", "", "   "]) {
      expect(isEvalToolName(name)).toBe(false)
    }
  })

  test("#given a mixed wave #when aggregated #then it never leaks into the non_eval totals", () => {
    const summary = summarizeWaveBuckets([wave(["bash", "eval"], 1_200), wave(["bash", "read"], 400)])

    expect(summary.nonEval.wavesTotal).toBe(1)
    expect(summary.nonEval.joinedCalls).toBe(2)
    expect(summary.mixedWaves).toBe(1)
    expect(summary.evalOnlyWaves).toBe(0)
  })

  test("#given eval_only and mixed waves #when tool-call counters are aggregated #then only the non_eval domain is counted", () => {
    const nonEvalOnly = summarizeWaveBuckets([
      wave(["bash", "read", "grep"]),
      wave(["bash", "read"]),
      wave(["read"]),
    ])
    const polluted = summarizeWaveBuckets([
      wave(["bash", "read", "grep"]),
      wave(["bash", "read"]),
      wave(["read"]),
      wave(["eval"]),
      wave(["eval", "eval", "eval"]),
      wave(["bash", "eval"]),
      wave(["bash", "read", "eval"]),
    ])

    expect(polluted.nonEval.wavesTotal).toBe(nonEvalOnly.nonEval.wavesTotal)
    expect(polluted.nonEval.wavesMulti).toBe(nonEvalOnly.nonEval.wavesMulti)
    expect(polluted.nonEval.joinedCalls).toBe(nonEvalOnly.nonEval.joinedCalls)
    expect(polluted.nonEval.waveSizeHistogram).toBe(nonEvalOnly.nonEval.waveSizeHistogram)
    expect(polluted.evalOuterJoinedCalls).toBe(6)
    expect(polluted.mixedNonEvalJoinedCalls).toBe(3)

    expect(polluted.nonEval.wavesTotal).toBe(3)
    expect(polluted.nonEval.wavesMulti).toBe(2)
    expect(polluted.nonEval.joinedCalls).toBe(6)
    expect(polluted.nonEval.waveSizeHistogram).toBe("1:1:1:0:0:0:0:0")
  })

  test("#given eval waves #when summarized #then their count and duration are reported in their own buckets", () => {
    const summary = summarizeWaveBuckets([
      wave(["eval"], 3_000),
      wave(["codemode"], 500),
      wave(["bash", "eval"], 1_200),
      wave(["bash"], 700),
    ])

    expect(summary.evalOnlyWaves).toBe(2)
    expect(summary.evalOnlyDurationMs).toBe(3_500)
    expect(summary.mixedWaves).toBe(1)
    expect(summary.evalOuterJoinedCalls).toBe(3)
    expect(summary.mixedNonEvalJoinedCalls).toBe(1)
    expect(summary.nonEval.wavesTotal).toBe(1)
  })

  test("#given wave sizes across every histogram bucket #when encoded #then counts are positional without labels", () => {
    const sizes = [1, 2, 3, 4, 6, 12, 20, 40]
    const summary = summarizeWaveBuckets(sizes.map((size) => wave(Array.from({ length: size }, () => "bash"))))

    expect(summary.nonEval.waveSizeHistogram).toBe("1:1:1:1:1:1:1:1")
    expect(summary.nonEval.waveSizeHistogram).not.toContain("=")
  })

  test("#given malformed waves #when classified #then no throw and no misclassification", () => {
    expect(classifyWaveBucket(wave([]))).toBe("non_eval")
    expect(classifyWaveBucket(wave(["", "   "]))).toBe("non_eval")
    expect(classifyWaveBucket(wave(["코드", "EVAL"]))).toBe("mixed")
    expect(classifyWaveBucket(wave(["Ｅｖａｌ"]))).toBe("non_eval")

    const summary = summarizeWaveBuckets([wave([]), wave([""], 100)])
    expect(summary.nonEval.wavesTotal).toBe(2)
    expect(summary.nonEval.joinedCalls).toBe(1)
  })

  test("#given repeated summaries of the same input #when compared #then the classifier holds no cross-call state", () => {
    const waves = [wave(["bash", "read"]), wave(["eval"], 900), wave(["bash", "eval"], 1_100)]
    const first = summarizeWaveBuckets(waves)
    const second = summarizeWaveBuckets(waves)

    expect(second).toEqual(first)
    expect(summarizeWaveBuckets([]).nonEval.waveSizeHistogram).toBe("0:0:0:0:0:0:0:0")
  })
})
