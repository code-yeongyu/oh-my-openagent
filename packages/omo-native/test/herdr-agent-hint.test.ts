import { describe, expect, test } from "bun:test"

import { HERDR_AGENT_LABEL, HERDR_AGENT_MARKER, withHerdrAgentHint } from "../bin/lib/herdr-agent-hint.js"

const tty = true

describe("withHerdrAgentHint (#10448)", () => {
  test("#given an interactive launch inside herdr #then the engine is named the way herdr reads it, and the launcher marks it", () => {
    const env = withHerdrAgentHint({ HERDR_ENV: "1" }, ["fix the bug"], tty)
    expect(env.HERDR_AGENT).toBe(HERDR_AGENT_LABEL)
    expect(env[HERDR_AGENT_MARKER]).toBe(HERDR_AGENT_LABEL)
    expect(HERDR_AGENT_LABEL).toBe("pi")
  })

  test("#given no arguments inside herdr #then the hint is set", () => {
    expect(withHerdrAgentHint({ HERDR_ENV: "1" }, [], tty).HERDR_AGENT).toBe("pi")
  })

  test("#given a print flag after `--` #then it is prompt text, not a flag, and the hint is set", () => {
    expect(withHerdrAgentHint({ HERDR_ENV: "1" }, ["--", "-p"], tty).HERDR_AGENT).toBe("pi")
  })

  test.each([
    ["outside herdr", {}, [], tty],
    ["HERDR_ENV other than 1", { HERDR_ENV: "0" }, [], tty],
    ["a print run", { HERDR_ENV: "1" }, ["-p", "hi"], tty],
    ["a --print run", { HERDR_ENV: "1" }, ["--print", "hi"], tty],
    ["a protocol run", { HERDR_ENV: "1" }, ["--mode", "rpc"], tty],
    ["a --mode= run", { HERDR_ENV: "1" }, ["--mode=json"], tty],
    ["piped stdin", { HERDR_ENV: "1" }, [], false],
  ] as const)("#given %s #then no hint and no marker are set", (_name, env, args, stdinIsTTY) => {
    const out = withHerdrAgentHint({ ...env }, [...args], stdinIsTTY)
    expect(out.HERDR_AGENT).toBeUndefined()
    expect(out[HERDR_AGENT_MARKER]).toBeUndefined()
  })

  test("#given a HERDR_AGENT the user set #then it is left as is and not marked", () => {
    const env = withHerdrAgentHint({ HERDR_ENV: "1", HERDR_AGENT: "claude" }, [], tty)
    expect(env.HERDR_AGENT).toBe("claude")
    expect(env[HERDR_AGENT_MARKER]).toBeUndefined()
  })

  test.each([
    ["a user-set HERDR_AGENT", { HERDR_ENV: "1", HERDR_AGENT: "claude" }, [], tty],
    ["a user-set pi", { HERDR_ENV: "1", HERDR_AGENT: "pi" }, [], tty],
    ["outside herdr", { HERDR_AGENT: "claude" }, [], tty],
    ["piped stdin", { HERDR_ENV: "1", HERDR_AGENT: "claude" }, [], false],
    ["a print run", { HERDR_ENV: "1", HERDR_AGENT: "claude" }, ["-p", "hi"], tty],
  ] as const)("#given %s and an inherited marker matching it #then the marker is dropped, so the plugin keeps the user's value", (_name, env, args, stdinIsTTY) => {
    const out = withHerdrAgentHint({ ...env, [HERDR_AGENT_MARKER]: env.HERDR_AGENT }, [...args], stdinIsTTY)
    expect(out[HERDR_AGENT_MARKER]).toBeUndefined()
    expect(out.HERDR_AGENT).toBe(env.HERDR_AGENT)
  })

  test("#given an empty HERDR_AGENT #then it is treated as unset", () => {
    expect(withHerdrAgentHint({ HERDR_ENV: "1", HERDR_AGENT: "" }, [], tty).HERDR_AGENT).toBe("pi")
  })
})
