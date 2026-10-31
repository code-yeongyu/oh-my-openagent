import { describe, expect, test } from "bun:test"
import { resolveServerUrl } from "./resolve-server-url"

function noopLog(): void {}

describe("resolveServerUrl", () => {
  describe("#given ctx.serverUrl reports port 0 (default TUI launch with --port 0)", () => {
    test("#when the SDK client exposes a real bound base URL #then it returns the discovered URL instead of discarding it for localhost:4096", () => {
      // issue #3963: opencode binds an ephemeral port but ctx.serverUrl says :0;
      // the old code replaced the URL with http://localhost:4096 which nothing
      // listens on, so tmux visualization silently skipped pane creation.
      const result = resolveServerUrl(
        "http://127.0.0.1:0/",
        {},
        noopLog,
        "http://127.0.0.1:50946",
      )

      expect(result).toBe("http://127.0.0.1:50946")
    })

    test("#when no discovered URL is available #then it keeps the OPENCODE_PORT fallback behavior", () => {
      const result = resolveServerUrl(
        "http://127.0.0.1:0/",
        { OPENCODE_PORT: "4321" },
        noopLog,
      )

      expect(result).toBe("http://localhost:4321")
    })

    test("#when neither a discovered URL nor OPENCODE_PORT exists #then it falls back to localhost:4096", () => {
      const result = resolveServerUrl("http://127.0.0.1:0/", {}, noopLog)

      expect(result).toBe("http://localhost:4096")
    })

    test("#when the discovered URL is unusable (port 0 as well) #then it falls back instead of trusting it", () => {
      const result = resolveServerUrl(
        "http://127.0.0.1:0/",
        { OPENCODE_PORT: "4321" },
        noopLog,
        "http://127.0.0.1:0/",
      )

      expect(result).toBe("http://localhost:4321")
    })
  })

  describe("#given ctx.serverUrl has a real non-zero port", () => {
    test("#when a discovered URL is also available #then the advertised serverUrl wins unchanged", () => {
      const result = resolveServerUrl(
        "http://127.0.0.1:4096/",
        {},
        noopLog,
        "http://127.0.0.1:50946",
      )

      expect(result).toBe("http://127.0.0.1:4096/")
    })
  })

  describe("#given ctx.serverUrl is undefined", () => {
    test("#when a discovered URL is available #then fallback behavior is unchanged (undefined-serverUrl recovery is the separate #5107 lane)", () => {
      const result = resolveServerUrl(undefined, {}, noopLog, "http://127.0.0.1:50946")

      expect(result).toBe("http://localhost:4096")
    })
  })
})
