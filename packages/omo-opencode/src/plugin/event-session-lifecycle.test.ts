import { beforeEach, describe, expect, it, mock } from "bun:test"

import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import {
  _resetForTesting,
  getMainSessionID,
  setMainSession,
} from "../features/claude-code-session-state"
import {
  BTW_SIDE_METADATA_KEY,
  createBtwSideMetadata,
} from "../features/btw-side/metadata"
import { resetBtwSideSessionRegistryForTesting } from "../features/btw-side/server-session-registry"
import {
  handleSessionCreatedEvent,
  handleSessionDeletedEvent,
  shouldDispatchOpenClawSessionEvent,
} from "./event-session-lifecycle"

function createHarness() {
  const onSessionCreated = mock(async () => undefined)
  const onSessionDeleted = mock(async () => undefined)
  const disconnectSession = mock(async () => undefined)
  const markSessionCreated = mock(() => undefined)
  const clear = mock(() => undefined)
  return {
    onSessionCreated,
    onSessionDeleted,
    disconnectSession,
    markSessionCreated,
    clear,
    managers: unsafeTestValue({
      tmuxSessionManager: {
        onSessionCreated,
        onSessionDeleted,
      },
      skillMcpManager: {
        disconnectSession,
      },
    }),
    gate: unsafeTestValue({
      markSessionCreated,
      clear,
    }),
  }
}

function sideInfo() {
  return {
    id: "ses_side",
    title: "BTW · Parent",
    metadata: {
      [BTW_SIDE_METADATA_KEY]: createBtwSideMetadata({
        parentSessionID: "ses_parent",
        boundaryMessageID: "msg_parent",
      }),
    },
  }
}

describe("BTW server session lifecycle", () => {
  beforeEach(() => {
    _resetForTesting()
    resetBtwSideSessionRegistryForTesting()
  })

  it("#given a main session #when a BTW root session is created #then main ownership and primary integrations stay unchanged", async () => {
    // given
    const harness = createHarness()
    setMainSession("ses_parent")

    // when
    await handleSessionCreatedEvent({
      event: unsafeTestValue({
        type: "session.created",
        properties: {
          info: sideInfo(),
        },
      }),
      props: {
        info: sideInfo(),
      },
      tmuxIntegrationEnabled: true,
      pluginConfig: unsafeTestValue({}),
      pluginContext: unsafeTestValue({}),
      managers: harness.managers,
      firstMessageVariantGate: harness.gate,
    })

    // then
    expect(getMainSessionID()).toBe("ses_parent")
    expect(harness.onSessionCreated).not.toHaveBeenCalled()
    expect(harness.markSessionCreated).not.toHaveBeenCalled()
  })

  it("#given a tracked BTW root session #when it is deleted #then main ownership and primary integrations stay unchanged", async () => {
    // given
    const harness = createHarness()
    setMainSession("ses_parent")
    await handleSessionCreatedEvent({
      event: unsafeTestValue({
        type: "session.created",
        properties: {
          info: sideInfo(),
        },
      }),
      props: {
        info: sideInfo(),
      },
      tmuxIntegrationEnabled: true,
      pluginConfig: unsafeTestValue({}),
      pluginContext: unsafeTestValue({}),
      managers: harness.managers,
      firstMessageVariantGate: harness.gate,
    })

    // when
    await handleSessionDeletedEvent({
      props: {
        info: sideInfo(),
      },
      tmuxIntegrationEnabled: true,
      pluginConfig: unsafeTestValue({}),
      pluginContext: unsafeTestValue({}),
      managers: harness.managers,
      firstMessageVariantGate: harness.gate,
      clearModelFallbackSession: () => undefined,
    })

    // then
    expect(getMainSessionID()).toBe("ses_parent")
    expect(harness.onSessionDeleted).not.toHaveBeenCalled()
    expect(harness.disconnectSession).toHaveBeenCalledWith("ses_side")
  })

  it("#given a persisted BTW root reattaches after restart #when it is deleted #then metadata still suppresses primary integrations", async () => {
    // given
    const harness = createHarness()
    setMainSession("ses_parent")

    // when
    await handleSessionDeletedEvent({
      props: {
        info: sideInfo(),
      },
      tmuxIntegrationEnabled: true,
      pluginConfig: unsafeTestValue({}),
      pluginContext: unsafeTestValue({}),
      managers: harness.managers,
      firstMessageVariantGate: harness.gate,
      clearModelFallbackSession: () => undefined,
    })

    // then
    expect(getMainSessionID()).toBe("ses_parent")
    expect(harness.onSessionDeleted).not.toHaveBeenCalled()
    expect(harness.disconnectSession).toHaveBeenCalledWith("ses_side")
  })

  it("#given a tracked BTW root session #when OpenClaw dispatch is considered #then side events are suppressed", async () => {
    // given
    const harness = createHarness()
    await handleSessionCreatedEvent({
      event: unsafeTestValue({
        type: "session.created",
        properties: {
          info: sideInfo(),
        },
      }),
      props: {
        info: sideInfo(),
      },
      tmuxIntegrationEnabled: false,
      pluginConfig: unsafeTestValue({}),
      pluginContext: unsafeTestValue({}),
      managers: harness.managers,
      firstMessageVariantGate: harness.gate,
    })

    // when
    const sideAllowed = shouldDispatchOpenClawSessionEvent("ses_side")
    const parentAllowed = shouldDispatchOpenClawSessionEvent("ses_parent")

    // then
    expect(sideAllowed).toBe(false)
    expect(parentAllowed).toBe(true)
  })
})
