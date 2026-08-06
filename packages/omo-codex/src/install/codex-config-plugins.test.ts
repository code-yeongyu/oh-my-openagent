import { describe, expect, test } from "bun:test"

import { ensureHookTrusted } from "./codex-config-plugins"

const WINDOWS_HOOK_KEY = String.raw`C:\Users\lenovo\hooks.json:session_start:0:0`

describe("ensureHookTrusted", () => {
  test("#given single-quoted literal hook state table #when ensuring same Windows hook key #then updates in place", () => {
    // given
    const config = String.raw`[hooks.state.'C:\Users\lenovo\hooks.json:session_start:0:0']
trusted_hash = "sha256:old"
`

    // when
    const updated = ensureHookTrusted(config, {
      key: WINDOWS_HOOK_KEY,
      trustedHash: "sha256:new",
    })

    // then
    expect(countHookStateSections(updated)).toBe(1)
    expect(updated).toContain(String.raw`[hooks.state.'C:\Users\lenovo\hooks.json:session_start:0:0']`)
    expect(updated).toContain('trusted_hash = "sha256:new"')
    expect(updated).not.toContain("sha256:old")
  })

  test("#given double-quoted basic hook state table #when ensuring same Windows hook key #then updates in place", () => {
    // given
    const config = String.raw`[hooks.state."C:\\Users\\lenovo\\hooks.json:session_start:0:0"]
trusted_hash = "sha256:old"
`

    // when
    const updated = ensureHookTrusted(config, {
      key: WINDOWS_HOOK_KEY,
      trustedHash: "sha256:new",
    })

    // then
    expect(countHookStateSections(updated)).toBe(1)
    expect(updated).toContain(String.raw`[hooks.state."C:\\Users\\lenovo\\hooks.json:session_start:0:0"]`)
    expect(updated).toContain('trusted_hash = "sha256:new"')
    expect(updated).not.toContain("sha256:old")
  })
})

function countHookStateSections(config: string): number {
  return config.match(/^\[hooks\.state\./gm)?.length ?? 0
}
