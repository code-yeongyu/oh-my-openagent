import { expect, test } from "bun:test"
import { compareMemberBoot } from "./qa/member-boot-diff"

function profile(head: string, modules: string[]) {
  return { head, platform: "win32", bun: "1.4.2", graphs: [1, 2].flatMap(launch =>
    ["bootstrap", "provider_registered", "session_start"].map(stage => ({ launch, stage, elapsed_ms: launch, modules }))) }
}

test("#given boot graphs in different orders #when compared #then only added and removed modules are reported", () => {
  const result = compareMemberBoot(profile("base", ["shared", "old"]), profile("candidate", ["new", "shared"]))
  expect(result.differences).toHaveLength(6)
  for (const difference of result.differences) {
    expect(difference).toMatchObject({ added: ["new"], removed: ["old"], base_count: 2, candidate_count: 2 })
  }
})

test("#given an incomplete or incompatible boot profile #when compared #then no complete comparison is claimed", () => {
  const base = profile("base", ["shared"])
  expect(() => compareMemberBoot(base, { ...base, graphs: base.graphs.slice(1) })).toThrow()
  expect(() => compareMemberBoot(base, { ...base, platform: "darwin" })).toThrow()
  expect(() => compareMemberBoot(base, { ...base, bun: "1.4.1" })).toThrow()
})
