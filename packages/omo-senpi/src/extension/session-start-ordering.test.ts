/// <reference types="bun-types" />

import { statSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, mock as mockFn, spyOn, test } from "bun:test"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { createInitDeepAdvisorComponent, processStartTime } from "../components/init-deep-advisor"
import {
  makeCoverageRepo,
  resetTestHome,
  setTestHome,
} from "../components/init-deep-advisor/component.test-support"
import { createOnboardingComponent } from "../components/onboarding"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwLoopComponent } from "../components/ulw-loop"
import { activeStatus, createLogger, sessionEventCtx } from "../components/ulw-loop/ulw-loop.test-support"
import { getOmoNativeStateDir } from "../components/telemetry/product-identity"
import { IdleInjectionCoordinator } from "./idle-injection-coordinator"
import { omoSenpiComponents } from "./index"
import type { ComponentContext } from "./types"

afterEach(() => resetTestHome())

describe("session_start component ordering", () => {
  test("#given the production component list #when startup handlers are ordered #then onboarding immediately precedes the advisor after native badge", () => {
    // given
    const names = omoSenpiComponents.map(({ name }) => name)

    // when
    const nativeBadgeIndex = names.indexOf("native-badge")
    const onboardingIndex = names.indexOf("onboarding")
    const advisorIndex = names.indexOf("init-deep-advisor")

    // then
    expect(onboardingIndex).toBe(nativeBadgeIndex + 1)
    expect(advisorIndex).toBe(onboardingIndex + 1)
    expect(onboardingIndex).toBeLessThan(advisorIndex)
  })

  test("#given real onboarding state and an active ulw loop #when startup then agent_end fire #then onboarding is preserved and the first-session advisor stays detached and suppressed", async () => {
    // given
    setTestHome("missing")
    const root = makeCoverageRepo()
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const scheduledFlushes: Array<() => void> = []
    const idleCoordinator = new IdleInjectionCoordinator(() => undefined, {
      scheduleFlush: (flush) => scheduledFlushes.push(flush),
    })
    const enqueue = spyOn(idleCoordinator, "enqueue")
    const scheduleFlush = spyOn(idleCoordinator, "scheduleFlush")
    const sendMessage = spyOn(pi, "sendMessage")
    const select = mockFn(async () => undefined)
    // The ulw-loop probe is session-scoped and fails closed without a session id, so the context carries
    // the host session identity the real Senpi host exposes.
    const eventCtx = sessionEventCtx(root, { hasUI: true, ui: { select } })
    const componentContext: ComponentContext = {
      logger,
      config: { getFlag: (name) => pi.getFlag(name) },
      idleCoordinator,
    }
    const components = [
      createOnboardingComponent(),
      createInitDeepAdvisorComponent(),
      createUltraworkComponent(),
      createUlwLoopComponent({
        resolveOmoBin: () => "/tmp/omo-agent-toolkit",
        runCommand: async () => ({ code: 0, stdout: activeStatus() }),
        // This fixture asserts handler ordering; seeding a real `.omo` ledger would also flip the
        // onboarding/advisor state the test pins, so the plan lookup is stubbed active instead.
        planExists: () => true,
      }),
    ]
    for (const component of components) await component.register(pi, componentContext)

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, eventCtx)

    // then
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "omo-onboarding:bootstrap",
        content: expect.stringMatching(/^Read the onboarding skill at/),
      }),
      expect.objectContaining({ triggerTurn: true, deliverAs: "followUp" }),
    )
    const markerPath = join(getOmoNativeStateDir(process.env), "onboarding-completed")
    expect(statSync(markerPath).mtimeMs).toBeGreaterThanOrEqual(processStartTime)
    expect(select).not.toHaveBeenCalled()

    // when
    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx)

    // then
    expect(enqueue).toHaveBeenCalled()
    expect(scheduleFlush).toHaveBeenCalled()
    expect(scheduledFlushes).toHaveLength(1)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
