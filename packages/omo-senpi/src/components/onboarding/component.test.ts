/// <reference types="bun-types" />

import type { SessionStartEvent } from "@code-yeongyu/senpi"
import { describe, expect, mock as mockFn, spyOn, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createOnboardingComponent } from "./component"

class OnboardingFakeExtensionAPI extends FakeExtensionAPI {
  readonly appendEntry = mockFn((_customType: string, _data?: unknown): void => {})
}

const componentContext: ComponentContext = {
  logger: {
    info() {},
    warn() {},
    error() {},
  },
  config: { getFlag: () => false },
}

function createHarness(claimResult = true) {
  const pi = new OnboardingFakeExtensionAPI()
  const mock = {
    claimOnboarding: mockFn((_stateDir: string): boolean => claimResult),
    sendMessage: spyOn(pi, "sendMessage"),
    appendEntry: pi.appendEntry,
  }
  createOnboardingComponent({ claimOnboarding: mock.claimOnboarding }).register(pi, componentContext)
  return { pi, mock }
}

async function dispatchSessionStart(
  pi: FakeExtensionAPI,
  reason: SessionStartEvent["reason"],
  hasUI = true,
): Promise<void> {
  await pi.dispatch("session_start", { type: "session_start", reason }, { ui: {}, hasUI })
}

describe("createOnboardingComponent", () => {
  test("#given a startup session #when session_start fires #then onboarding is claimed before bootstrap injection", async () => {
    // given
    const { pi, mock } = createHarness()

    // when
    await dispatchSessionStart(pi, "startup")

    // then
    expect(pi.flags).toEqual([{
      name: "onboard",
      options: {
        type: "boolean",
        default: false,
        description: "Force the onboarding flow on startup.",
      },
    }])
    expect(mock.claimOnboarding).toHaveBeenCalledTimes(1)
    expect(mock.sendMessage).toHaveBeenCalledTimes(1)
    expect(mock.claimOnboarding.mock.invocationCallOrder[0]).toBeLessThan(
      mock.sendMessage.mock.invocationCallOrder[0],
    )
    expect(mock.claimOnboarding.mock.invocationCallOrder.filter(
      (order) => order > mock.sendMessage.mock.invocationCallOrder[0],
    )).toHaveLength(0)
    expect(mock.sendMessage).toHaveBeenCalledWith({
      customType: "omo-onboarding:bootstrap",
      content: expect.stringContaining("Read the onboarding skill at"),
      display: false,
    }, { triggerTurn: true, deliverAs: "followUp" })
    expect(mock.appendEntry).toHaveBeenCalledWith("omo-onboarding:started", {
      reason: "startup",
      forced: false,
    })
  })

  test("#given reason new #when session_start fires #then onboarding is not injected", async () => {
    // given
    const { pi, mock } = createHarness()

    // when
    await dispatchSessionStart(pi, "new")

    // then
    expect(mock.claimOnboarding).not.toHaveBeenCalled()
    expect(mock.sendMessage).not.toHaveBeenCalled()
    expect(mock.appendEntry).not.toHaveBeenCalled()
  })

  for (const reason of ["reload", "resume", "fork"] as const) {
    test(`#given reason ${reason} #when session_start fires #then onboarding is not injected`, async () => {
      // given
      const { pi, mock } = createHarness()

      // when
      await dispatchSessionStart(pi, reason)

      // then
      expect(mock.claimOnboarding).not.toHaveBeenCalled()
      expect(mock.sendMessage).not.toHaveBeenCalled()
      expect(mock.appendEntry).not.toHaveBeenCalled()
    })
  }

  test("#given the onboarding component is disabled #when startup fires #then onboarding is not injected", async () => {
    // given
    const { pi, mock } = createHarness()
    pi.setFlag("omo-senpi-onboarding-disabled", true)

    // when
    await dispatchSessionStart(pi, "startup")

    // then
    expect(mock.claimOnboarding).not.toHaveBeenCalled()
    expect(mock.sendMessage).not.toHaveBeenCalled()
    expect(mock.appendEntry).not.toHaveBeenCalled()
  })

  test("#given force onboarding and an existing marker #when startup fires twice #then force injects only once per process", async () => {
    // given
    const { pi, mock } = createHarness(false)
    pi.setFlag("onboard", true)

    // when
    await dispatchSessionStart(pi, "startup")
    await dispatchSessionStart(pi, "startup")

    // then
    expect(mock.claimOnboarding).not.toHaveBeenCalled()
    expect(mock.sendMessage).toHaveBeenCalledTimes(1)
    expect(mock.appendEntry).toHaveBeenCalledTimes(1)
    expect(mock.appendEntry).toHaveBeenCalledWith("omo-onboarding:started", {
      reason: "startup",
      forced: true,
    })
  })

  test("#given a headless session #when startup fires #then onboarding is neither claimed nor injected", async () => {
    // given
    const { pi, mock } = createHarness()

    // when
    await dispatchSessionStart(pi, "startup", false)

    // then
    expect(mock.sendMessage).not.toHaveBeenCalled()
    expect(mock.appendEntry).not.toHaveBeenCalled()
    expect(mock.claimOnboarding).not.toHaveBeenCalled()
  })

  test("#given a headless session with force #when startup fires #then onboarding is still not injected", async () => {
    // given
    const { pi, mock } = createHarness()
    pi.setFlag("onboard", true)

    // when
    await dispatchSessionStart(pi, "startup", false)

    // then
    expect(mock.sendMessage).not.toHaveBeenCalled()
    expect(mock.appendEntry).not.toHaveBeenCalled()
  })

  test("#given an existing marker without force #when startup fires #then claim blocks onboarding injection", async () => {
    // given
    const { pi, mock } = createHarness(false)

    // when
    await dispatchSessionStart(pi, "startup")

    // then
    expect(mock.claimOnboarding).toHaveBeenCalledTimes(1)
    expect(mock.sendMessage).not.toHaveBeenCalled()
    expect(mock.appendEntry).not.toHaveBeenCalled()
  })
})
