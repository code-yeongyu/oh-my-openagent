import { availableParallelism } from "node:os"
import { describe, expect, test } from "bun:test"

import { resolveOmoTaskSettings } from "@oh-my-opencode/omo-config-core"

describe("task settings", () => {
  test("#given no residency override #when settings parse #then defaults residency cap to bounded two-per-cpu headroom", () => {
    // given
    const expected = Math.min(16, Math.max(8, availableParallelism() * 2))

    // when
    const settings = resolveOmoTaskSettings({})
    const twoCpuSettings = resolveOmoTaskSettings({}, () => 2)
    const fourCpuSettings = resolveOmoTaskSettings({}, () => 4)

    // then
    expect(settings.residency_max_children).toBe(expected)
    expect(twoCpuSettings.residency_max_children).toBe(8)
    expect(fourCpuSettings.residency_max_children).toBe(8)
    expect(twoCpuSettings.global_concurrency).toBe(8)
    expect(resolveOmoTaskSettings({}, () => 6).global_concurrency).toBe(12)
    expect(resolveOmoTaskSettings({ global_concurrency: 3 }, () => 6).global_concurrency).toBe(3)
  })
})
