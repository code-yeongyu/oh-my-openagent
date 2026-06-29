import { describe, expect, test } from "bun:test"

import { ensureHookTrusted, ensureOmoDisableSwitches } from "./codex-config-plugins"

const WINDOWS_HOOK_KEY = String.raw`C:\Users\lenovo\hooks.json:session_start:0:0`

describe("ensureHookTrusted", () => {
  test("#given placeholder hook disable config #when trusting aggregate hook #then preserves disable table", () => {
    // given
    const config = `[plugins."omo@sisyphuslabs".hooks.comment_checker]\nenabled = false\nreason = "baseline fixture"\n`

    // when
    const updated = ensureHookTrusted(config, {
      key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0",
      trustedHash: "sha256:hook",
    })

    // then
    expect(updated).toContain('[plugins."omo@sisyphuslabs".hooks.comment_checker]')
    expect(updated).toContain("enabled = false")
    expect(updated).toContain('reason = "baseline fixture"')
    expect(updated).toContain('[hooks.state."omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0"]')
    expect(updated).toContain('trusted_hash = "sha256:hook"')
  })

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

describe("ensureOmoDisableSwitches", () => {
  test("#given custom hook and rule disable tables #when seeding OMO switches #then preserves custom disables", () => {
    // given
    const config = [
      '[plugins."omo@sisyphuslabs".hooks.comment_checker]',
      "enabled = false",
      'reason = "disable noisy comment lint for vendored sync"',
      "",
      '[plugins."omo@sisyphuslabs".rules.hephaestus]',
      "enabled = false",
      'reason = "project owns its own discipline rules"',
      "",
    ].join("\n")

    // when
    const updated = ensureOmoDisableSwitches(config, {
      marketplaceName: "sisyphuslabs",
      pluginNames: ["omo"],
    })

    // then
    expect(updated).toContain('[plugins."omo@sisyphuslabs".hooks.comment_checker]')
    expect(updated).toContain('reason = "disable noisy comment lint for vendored sync"')
    expect(updated).toContain('[plugins."omo@sisyphuslabs".rules.hephaestus]')
    expect(updated).toContain('reason = "project owns its own discipline rules"')
    expect(sectionFor(updated, '[plugins."omo@sisyphuslabs".hooks.comment_checker]')).toContain("enabled = false")
    expect(sectionFor(updated, '[plugins."omo@sisyphuslabs".rules.hephaestus]')).toContain("enabled = false")
    expect(sectionFor(updated, '[plugins."omo@sisyphuslabs".hooks.user_prompt_submit_loading_project_rules]')).toContain(
      "enabled = true",
    )
    expect(sectionFor(updated, '[plugins."omo@sisyphuslabs".rules.windows_git_bash]')).toContain("enabled = true")
  })

  test("#given another marketplace #when seeding OMO switches #then config is unchanged", () => {
    // given
    const config = '[plugins."other@vendor"]\nenabled = true\n'

    // when
    const updated = ensureOmoDisableSwitches(config, {
      marketplaceName: "vendor",
      pluginNames: ["other"],
    })

    // then
    expect(updated).toBe(config)
  })
})

function countHookStateSections(config: string): number {
  return config.match(/^\[hooks\.state\./gm)?.length ?? 0
}

function sectionFor(config: string, header: string): string {
  const start = config.indexOf(header)
  if (start === -1) return ""
  const next = config.indexOf("\n[", start + header.length)
  return config.slice(start, next === -1 ? undefined : next)
}
