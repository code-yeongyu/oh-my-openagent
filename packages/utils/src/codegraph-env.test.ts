import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import {
  CODEGRAPH_INSTALL_DIR_ENV,
  CODEGRAPH_NO_DAEMON_ENV,
  CODEGRAPH_NO_DOWNLOAD_ENV,
  CODEGRAPH_TELEMETRY_ENV,
  DO_NOT_TRACK_ENV,
  buildCodegraphChildEnv,
  buildCodegraphEnv,
} from "./codegraph/env"

describe("buildCodegraphEnv", () => {
  it("forces telemetry off and scopes the CodeGraph install cache under ~/.omo/codegraph", () => {
    // given
    const homeDir = "/Users/alice"

    // when
    const result = buildCodegraphEnv({ homeDir })

    // then
    expect(result).toEqual({
      [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
      [CODEGRAPH_NO_DAEMON_ENV]: "1",
      [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
      [CODEGRAPH_TELEMETRY_ENV]: "0",
      [DO_NOT_TRACK_ENV]: "1",
    })
    expect("CODEGRAPH_DIR" in result).toBe(false)
  })

  it("omits CODEGRAPH_NO_DAEMON entirely when daemon is enabled", () => {
    // given
    const homeDir = "/Users/alice"

    // when
    const result = buildCodegraphEnv({ homeDir, daemon: true })

    // then
    expect(result).toEqual({
      [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
      [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
      [CODEGRAPH_TELEMETRY_ENV]: "0",
      [DO_NOT_TRACK_ENV]: "1",
    })
    expect(CODEGRAPH_NO_DAEMON_ENV in result).toBe(false)
  })

  it("builds a child process env without ambient provider tokens", () => {
    // given
    const result = buildCodegraphChildEnv({
      ambientEnv: {
        ANTHROPIC_API_KEY: "anthropic-secret",
        GITHUB_TOKEN: "github-secret",
        HOME: "/Users/alice",
        OPENAI_API_KEY: "openai-secret",
        PATH: "/usr/local/bin:/usr/bin",
      },
      codegraphEnv: {
        CODEGRAPH_INSTALL_DIR: "/Users/alice/.omo/codegraph",
        CODEGRAPH_NO_DOWNLOAD: "1",
      },
      runtimeEnv: {
        CODEGRAPH_FAKE_LOG: "/tmp/codegraph.log",
        SLACK_BOT_TOKEN: "slack-secret",
      },
    })

    // then
    expect(result).toEqual({
      CODEGRAPH_FAKE_LOG: "/tmp/codegraph.log",
      CODEGRAPH_INSTALL_DIR: "/Users/alice/.omo/codegraph",
      CODEGRAPH_NO_DOWNLOAD: "1",
      HOME: "/Users/alice",
      PATH: "/usr/local/bin:/usr/bin",
    })
    expect(result.OPENAI_API_KEY).toBeUndefined()
    expect(result.ANTHROPIC_API_KEY).toBeUndefined()
    expect(result.GITHUB_TOKEN).toBeUndefined()
    expect(result.SLACK_BOT_TOKEN).toBeUndefined()
  })

  describe("CODEGRAPH_NO_DAEMON merge precedence", () => {
    it("defaults to daemon-off when daemon is unset and ambient does not override", () => {
      // given
      const codegraphEnv = buildCodegraphEnv({ homeDir: "/Users/alice" })

      // when
      const result = buildCodegraphChildEnv({ codegraphEnv, runtimeEnv: {} })

      // then
      expect(result[CODEGRAPH_NO_DAEMON_ENV]).toBe("1")
    })

    it("keeps daemon-off even when ambient CODEGRAPH_NO_DAEMON is '0'", () => {
      // given
      const codegraphEnv = buildCodegraphEnv({ homeDir: "/Users/alice", daemon: false })

      // when
      const result = buildCodegraphChildEnv({
        codegraphEnv,
        runtimeEnv: { [CODEGRAPH_NO_DAEMON_ENV]: "0" },
      })

      // then
      expect(result[CODEGRAPH_NO_DAEMON_ENV]).toBe("1")
    })

    it("omits CODEGRAPH_NO_DAEMON from the child env when daemon is enabled", () => {
      // given
      const codegraphEnv = buildCodegraphEnv({ homeDir: "/Users/alice", daemon: true })

      // when
      const result = buildCodegraphChildEnv({ codegraphEnv, runtimeEnv: {} })

      // then
      expect(CODEGRAPH_NO_DAEMON_ENV in result).toBe(false)
    })

    it("honors an ambient CODEGRAPH_NO_DAEMON='1' escape hatch when daemon is enabled", () => {
      // given
      const codegraphEnv = buildCodegraphEnv({ homeDir: "/Users/alice", daemon: true })

      // when
      const result = buildCodegraphChildEnv({
        codegraphEnv,
        runtimeEnv: { [CODEGRAPH_NO_DAEMON_ENV]: "1" },
      })

      // then
      expect(result[CODEGRAPH_NO_DAEMON_ENV]).toBe("1")
    })

    it("forwards an ambient CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS to the child", () => {
      // given / when
      const result = buildCodegraphChildEnv({
        codegraphEnv: buildCodegraphEnv({ homeDir: "/Users/alice", daemon: true }),
        runtimeEnv: { CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS: "10000" },
      })

      // then
      expect(result["CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS"]).toBe("10000")
    })
  })
})
