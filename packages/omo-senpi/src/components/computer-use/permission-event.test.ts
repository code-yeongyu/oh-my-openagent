import { describe, expect, spyOn, test } from "bun:test"
import { capture, input, permissionSession } from "./permission-event.test-support"

describe("computer permission events through the real session", () => {
  for (const path of ["direct", "cua", "js", "py"] as const) {
    test(`emits the root permission event before returning a ${path} denial`, async () => {
      // given
      const fixture = await permissionSession()
      try {
        // when
        const result = path === "direct" || path === "cua"
          ? await fixture.execute(path === "direct" ? "computer" : "computer_actions",
              path === "direct" ? capture : { action: "screenshot" })
          : await fixture.execute("eval", {
              language: path,
              code: path === "js"
                ? `await tool.computer(${JSON.stringify(capture)}); print("arbitrary output")`
                : `await tool.computer(${JSON.stringify(capture)})\nprint("arbitrary output")`,
              summary: "Exercise computer permission denial",
            })
        // then
        expect(result).toBeDefined()
        // A cell that never reached the engine shows why (its error, or that it timed out) instead of only a missing call (#9495).
        expect(fixture.methods, JSON.stringify(result)).toContain("capture")
        expect(fixture.events).toEqual([{
          name: "omo.computer.permission_required",
          data: {
            session_id: fixture.session.sessionManager.getSessionId(),
            permission: "screen_recording",
            app: "Test App",
          },
        }])
      } finally {
        await fixture.close()
      }
    }, 120_000)
  }

  test("deduplicates cross-path denials but emits a second permission", async () => {
    // given
    const fixture = await permissionSession()
    try {
      // when
      await fixture.execute("computer", capture)
      await fixture.execute("eval", {
        language: "js",
        code: `await tool.computer(${JSON.stringify(capture)})`,
        summary: "Repeat the same denied capture",
      })
      await fixture.execute("computer", input)
      // then
      expect(fixture.events).toEqual(["screen_recording", "accessibility"].map((permission) => ({
        name: "omo.computer.permission_required",
        data: { session_id: fixture.session.sessionManager.getSessionId(), permission, app: "Test App" },
      })))
    } finally {
      await fixture.close()
    }
  }, 120_000)

  for (const error of ["Timeout", "InvalidTarget", "Internal", "StopPathUnavailable"]) {
    test(`never emits a permission event for ${error} with misleading permission data`, async () => {
      // given
      const fixture = await permissionSession({ error })
      try {
        // when
        await fixture.execute("computer", capture)
        // then
        expect(fixture.methods).toContain("capture")
        expect(fixture.events).toEqual([])
      } finally {
        await fixture.close()
      }
    }, 120_000)
  }

  for (const engineFailure of ["native-unavailable", "quarantined"] as const) {
    test(`never emits a permission event for an ${engineFailure} engine`, async () => {
      // given
      const fixture = await permissionSession({ engineFailure })
      try {
        // when
        await fixture.execute("computer", capture)
        // then
        expect(fixture.events).toEqual([])
      } finally {
        await fixture.close()
      }
    }, 120_000)
  }

  test("never emits for an unsupported host or invalid tool arguments", async () => {
    // given
    const unsupported = await permissionSession({ platform: "freebsd" })
    const supported = await permissionSession()
    try {
      // when / then
      await expect(unsupported.execute("computer", capture)).rejects.toThrow()
      await expect(supported.execute("computer", { action: "invalid" })).rejects.toThrow()
      expect(unsupported.events).toEqual([])
      expect(supported.events).toEqual([])
    } finally {
      await unsupported.close()
      await supported.close()
    }
  }, 120_000)

  test("drops an engine PermissionDenied whose permission data is not recognized", async () => {
    // given
    const fixture = await permissionSession({ permission: "camera" })
    try {
      // when
      await fixture.execute("computer", capture)
      // then
      expect(fixture.methods).toContain("capture")
      expect(fixture.events).toEqual([])
    } finally {
      await fixture.close()
    }
  }, 120_000)

  test("delivers the denial and preserves the caller error when its session marker cannot be saved", async () => {
    // given
    const fixture = await permissionSession()
    const marker = spyOn(fixture.session.sessionManager, "appendCustomEntry").mockImplementation(() => {
      throw new Error("Test session journal is read-only")
    })
    try {
      // when
      const first = await fixture.execute("computer", capture)
      await fixture.execute("computer", capture)
      // then
      expect(first).toMatchObject({ details: { value: { code: "COMPUTER_PERMISSION_REQUIRED" } } })
      expect(fixture.events).toEqual([{
        name: "omo.computer.permission_required",
        data: { session_id: fixture.session.sessionId, permission: "screen_recording", app: "Test App" },
      }])
    } finally {
      marker.mockRestore()
      await fixture.close()
    }
  }, 120_000)

  test("keeps a denied permission latched across reload after its marker write fails", async () => {
    // given
    const fixture = await permissionSession()
    const root = fixture.session.sessionId
    const marker = spyOn(fixture.session.sessionManager, "appendCustomEntry").mockImplementation(() => {
      throw new Error("Test session journal is read-only")
    })
    try {
      const first = await fixture.execute("computer", capture)
      marker.mockRestore()
      // when
      await fixture.reload()
      const second = await fixture.execute("computer", capture)
      // then
      expect(fixture.session.sessionId).toBe(root)
      expect(fixture.extensionErrors).toEqual([])
      expect(fixture.methods.filter(method => method === "capture")).toHaveLength(2)
      for (const result of [first, second]) {
        expect(result).toMatchObject({ details: { value: { code: "COMPUTER_PERMISSION_REQUIRED" } } })
      }
      expect(fixture.events).toEqual([{
        name: "omo.computer.permission_required",
        data: { session_id: root, permission: "screen_recording", app: "Test App" },
      }])
    } finally {
      marker.mockRestore()
      await fixture.close()
    }
  }, 120_000)
})
