import { describe, expect, it } from "bun:test"

import { validateOmoConfig } from "./omo-config"

describe("validateOmoConfig", () => {
  it("accepts codegraph settings with codex and opencode override blocks", () => {
    // given
    const config = {
      codegraph: {
        auto_provision: true,
        enabled: true,
        install_dir: "~/.omo/codegraph",
        excluded_roots: ["/tmp/omo-scratch"],
        telemetry: false,
        session_start_cooldown_ms: 900_000,
        watch_debounce_ms: 2_000,
      },
      "[codex]": {
        codegraph: {
          enabled: false,
        },
      },
      "[opencode]": {
        codegraph: {
          watch_debounce_ms: 500,
        },
      },
    }

    // when
    const result = validateOmoConfig(config)

    // then
    expect(result).toEqual({ errors: [], ok: true })
  })

  it("rejects a SessionStart cooldown below the safety floor", () => {
    // given
    const config = { "[codex]": { codegraph: { session_start_cooldown_ms: 59_999 } } }

    // when
    const result = validateOmoConfig(config)

    // then
    expect(result.ok).toBe(false)
    expect(result.errors).toContain("[codex].codegraph.session_start_cooldown_ms must be a finite number of at least 60000")
  })

  it("rejects unknown harness override blocks", () => {
    // given
    const config = { "[android]": {} }

    // when
    const result = validateOmoConfig(config)

    // then
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Unknown harness override block "[android]"')
  })

  it("flags settings used under unsupported harness blocks", () => {
    // given
    const config = {
      "[codex]": {
        codegraph: {
          watch_debounce_ms: 250,
        },
      },
    }

    // when
    const result = validateOmoConfig(config)

    // then
    expect(result.ok).toBe(false)
    expect(result.errors).toContain("codegraph.watch_debounce_ms is not supported for harness codex")
  })
})
