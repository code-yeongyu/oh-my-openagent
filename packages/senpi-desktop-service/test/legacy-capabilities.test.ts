import { expect, it } from "vitest"
import { runComputerSteps } from "../src/run/runtime"
import { DesktopService } from "../src/service/service"
import { fakeEngineFactory } from "./harness"

it("reports an older engine cursor overlay as unsupported inside a computer call", async () => {
  // Given: an engine whose capability reply predates cursorOverlay.
  const log = fakeEngineFactory({ FAKE_ENGINE_CURSOR_OMITTED: "1" })
  const service = new DesktopService({ createChild: log.factory })
  try {
    await service.open({})

    // When: the model reads the capability through the run facade.
    const result = await runComputerSteps(
      {
        toolCallId: "tool-call-1",
        snapshot: {
          cwd: "/work",
          sessionId: "legacy-capabilities",
          captureMaxWidth: 1280,
          captureMaxHeight: 800,
          captureMaxBytes: 5_000_000,
          display: "all",
          readOnly: true,
          stopHotkey: "ctrl+alt+shift+escape",
          allowHostRelayOnlyStop: false,
        },
        timeoutMs: 5_000,
      },
      { service },
      async ({ desktop }) => (await desktop.capabilities()).cursorOverlay,
    )

    // Then: an absent field is false, not an undefined model-facing value.
    expect(result.returnValue).toBe(false)
  } finally {
    await service.close()
  }
}, 30_000)
