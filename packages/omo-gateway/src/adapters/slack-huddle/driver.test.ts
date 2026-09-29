import { expect, test } from "bun:test"
import { CdpConnection, type CdpTransport } from "./cdp"
import type { ChromeSession } from "./browser"
import { HuddleDriver } from "./driver"
import { VoiceRefusal } from "./voice-contract"

const TEAM = "T_TEST"
const USER = "U_SELF"

/**
 * A browser that answers the protocol without being one: it attaches a page when asked to create a
 * target and reports every control as clicked, so the driver runs its whole join path and then fails
 * at the one thing a fake cannot provide - a real peer connection.
 */
function fakeBrowser(): { session: ChromeSession; closed: () => number } {
  let closes = 0
  let deliver: ((message: string) => void) | null = null
  const emit = (payload: unknown): void => deliver?.(JSON.stringify(payload))
  const transport: CdpTransport = {
    write(raw) {
      const message: { id?: number; method?: string; params?: { expression?: string } } = JSON.parse(raw)
      const id = message.id
      if (id === undefined) return
      if (message.method === "Runtime.evaluate") {
        const expression = message.params?.expression ?? ""
        const value = expression.includes("snapshot()") ? { peers: 0, tapping: false, peer_state: null } : { clicked: true, candidates: [] }
        queueMicrotask(() => emit({ id, result: { result: { value } } }))
        // pressing the huddle control opens a second window, as the real client does
        if (expression.includes("Start huddle")) {
          queueMicrotask(() => emit({ method: "Target.attachedToTarget", params: { sessionId: "S-call", targetInfo: { type: "page" } } }))
        }
        return
      }
      queueMicrotask(() => emit({ id, result: {} }))
      if (message.method === "Target.createTarget") {
        queueMicrotask(() => emit({ method: "Target.attachedToTarget", params: { sessionId: "S-main", targetInfo: { type: "page" } } }))
      }
      // the driver waits for the page to load before it touches any control
      if (message.method === "Page.navigate") {
        queueMicrotask(() => emit({ method: "Page.loadEventFired", params: {}, sessionId: "S-main" }))
      }
    },
    onMessage(handler) {
      deliver = handler
    },
    onClose() {},
    close() {},
  }
  const session: ChromeSession = {
    pid: 4242,
    profileDir: "/tmp/does-not-exist",
    connection: new CdpConnection(transport),
    exited: new Promise(() => undefined),
    stderrTail: () => "",
    close: async () => {
      closes += 1
    },
  }
  return { session, closed: () => closes }
}

const fakeFetch = (): typeof fetch =>
  (async () => Response.json({ ok: true, team_id: TEAM, user_id: USER, messages: [] })) as unknown as typeof fetch

const driverWith = (browser: ReturnType<typeof fakeBrowser>) =>
  new HuddleDriver({
    account_id: TEAM,
    session: { token: "unused-in-this-test", cookie: "unused-in-this-test" },
    profilesRoot: "/tmp/does-not-exist",
    launch: () => browser.session,
    fetchImpl: fakeFetch(),
    joinTimeoutMs: 300,
  })

test("a join that never reaches a live call fails with what the bridge saw, and closes the browser", async () => {
  const browser = fakeBrowser()
  const driver = driverWith(browser)
  const failure = await driver.join("C_TEST").then(() => null, (error: Error) => error)
  expect(failure?.message).toContain("peer_state")
  expect(failure?.message).toContain("bridge")
  // teardown on the failure path is what stops a dead call leaking a 600 MB browser
  expect(browser.closed()).toBe(1)
  expect(driver.status().state).toBe("idle")
})

test("a second call on the same account is refused while the first is still being joined", async () => {
  const browser = fakeBrowser()
  const driver = driverWith(browser)
  const first = driver.join("C_ONE").catch(() => undefined)
  const second = await driver.join("C_TWO").then(() => null, (error: Error) => error)
  expect(second).toBeInstanceOf(VoiceRefusal)
  expect((second as VoiceRefusal).reason).toBe("busy")
  expect(second?.message).toContain("one call per account")
  await first
})

test("speaking or leaving without a call is refused rather than pretended", async () => {
  const driver = driverWith(fakeBrowser())
  const refusal = await driver.speak(new Int16Array([1, 2, 3]), 48000).then(() => null, (error: Error) => error)
  expect(refusal).toBeInstanceOf(VoiceRefusal)
  expect(refusal?.message).toContain("no live call")
  await driver.leave()
  expect(driver.status()).toMatchObject({ state: "idle", capturing: false, participants: [] })
})
