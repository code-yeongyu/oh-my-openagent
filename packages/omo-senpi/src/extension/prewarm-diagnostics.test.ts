import { expect, test } from "bun:test"
import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "./compose"
import type { BeforeAgentStartHandlerOptions, ComponentLogger } from "./types"

async function fixture(options?: BeforeAgentStartHandlerOptions) {
  const pi = new FakeExtensionAPI()
  const warnings: { readonly message: string; readonly details: unknown }[] = []
  const logger: ComponentLogger = {
    info() {}, error() {},
    warn: (message, details) => { warnings.push({ message, details }) },
  }
  await composeOmoSenpiExtension([{
    name: "late-fixture",
    register(api) {
      api.on("session_start", () => {
        const event = "before_agent_start"
        api.on(event, () => undefined, options)
      })
    },
  }], { logger })(pi)
  return { pi, warnings }
}

test("#given a composed component #when it registers an unsafe handler at session_start #then its component and source are diagnosed", async () => {
  // given
  const { pi, warnings } = await fixture()
  expect(warnings).toEqual([])
  try {
    // when
    await pi.dispatch("session_start", { type: "session_start" })
    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.details).toMatchObject({
      component: "late-fixture", previewSafe: false,
      source: expect.stringContaining("prewarm-diagnostics.test.ts:"),
    })
  } finally {
    await pi.dispatch("session_shutdown", { type: "session_shutdown" })
  }
})

test("#given a composed component #when it registers a preview-safe handler late #then no diagnostic is emitted", async () => {
  // given
  const { pi, warnings } = await fixture({ previewSafe: true })
  try {
    // when
    await pi.dispatch("session_start", { type: "session_start" })
    // then
    expect(warnings).toEqual([])
    expect(pi.handlers.filter(({ event }) => event === "before_agent_start").at(-1)?.options).toEqual({ previewSafe: true })
  } finally {
    await pi.dispatch("session_shutdown", { type: "session_shutdown" })
  }
})

test("#given a skipped prewarm after late registration #when post-start events read its entry repeatedly #then exactly one session warning names the reason and handler", async () => {
  // given
  const { pi, warnings } = await fixture()
  const reason = "before_agent_start handlers not registered previewSafe: /extensions/omo.js"
  const ctx = { sessionManager: {
    getSessionId: () => "skipped-session",
    getEntries: () => [{ type: "custom", customType: "prompt-cache-prewarm", data: { phase: "skipped", provider: "fixture", model: "fixture", reason } }],
  } }
  await pi.dispatch("session_start", { type: "session_start" })
  warnings.length = 0
  try {
    // when
    await pi.dispatch("resources_discover", { type: "resources_discover" }, ctx)
    await pi.dispatch("agent_start", { type: "agent_start" }, ctx)
    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.details).toMatchObject({
      sessionId: "skipped-session", reason,
      handlers: [{ component: "late-fixture", previewSafe: false, source: expect.stringContaining("prewarm-diagnostics.test.ts:") }],
    })
  } finally {
    await pi.dispatch("session_shutdown", { type: "session_shutdown" })
  }
})

test("#given a warmed prewarm entry #when a post-start event reads it #then no warning is emitted", async () => {
  // given
  const { pi, warnings } = await fixture({ previewSafe: true })
  const ctx = { sessionManager: {
    getSessionId: () => "warmed-session",
    getEntries: () => [{ type: "custom", customType: "prompt-cache-prewarm", data: { phase: "warmed", provider: "fixture", model: "fixture" } }],
  } }
  try {
    // when
    await pi.dispatch("session_start", { type: "session_start" })
    await pi.dispatch("resources_discover", { type: "resources_discover" }, ctx)
    // then
    expect(warnings).toEqual([])
  } finally {
    await pi.dispatch("session_shutdown", { type: "session_shutdown" })
  }
})
