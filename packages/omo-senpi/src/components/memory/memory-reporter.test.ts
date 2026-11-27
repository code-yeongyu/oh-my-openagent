import { describe, expect, test } from "bun:test"
import { registerRecallMemoryReporter } from "./memory-reporter"

type Reporter = () => Readonly<Record<string, number>>

// oh-my-openagent#9442: the recall corpus and its BM25 term arrays join senpi's on-demand memory report.
describe("registerRecallMemoryReporter", () => {
  test("#given a host with the memory report API #when a report is taken #then it reads the process recall figures", () => {
    // given
    const registered = new Map<string, Reporter>()
    const pi = { registerMemoryReporter: (name: string, reporter: Reporter) => void registered.set(name, reporter) }
    registerRecallMemoryReporter(pi)

    // when
    const figures = registered.get("omoRecall")?.()

    // then
    expect(Object.keys(figures ?? {}).toSorted()).toEqual([
      "corpusCaches",
      "documentTextBytes",
      "documents",
      "termArrayBytes",
      "vocabularyTerms",
    ])
  })

  test("#given a host without the memory report API #when registering #then nothing throws", () => {
    expect(() => registerRecallMemoryReporter({})).not.toThrow()
  })
})
