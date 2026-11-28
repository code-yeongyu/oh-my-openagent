import { expect, test } from "bun:test"
import { setTimeout as wait } from "node:timers/promises"
import { guardOmowright } from "./skills/browser/scripts/browser-engine-guard.mjs"

const idleTimeoutMs = 20

function fixture({ headless = true, owned = true, failClose = false } = {}) {
  const command = Promise.withResolvers<string>()
  const response = Promise.withResolvers<number>()
  const closed = Promise.withResolvers<undefined>()
  let closeCount = 0
  const noop = async () => undefined
  const page = {
    waitForEvent: () => response.promise,
    waitForResponse() {
      return this.waitForEvent()
    },
    waitForLoadState: noop,
    waitForURL: noop,
    waitForTimeout: noop,
    goto: noop,
    goBack: noop,
    goForward: noop,
    reload: noop,
    setContent: noop,
  }
  const browser = {
    browserProcess: owned ? { pid: 1 } : undefined,
    cdp: {
      isHeadless: headless,
      send: async () => command.promise,
      close: async () => closed.resolve(undefined),
    },
    async newTab() {
      return this.attachPage()
    },
    async attachPage() {
      return Object.assign(page, { cdp: this.cdp })
    },
    async close() {
      closeCount++
      if (failClose) throw new Error("page teardown failed")
      closed.resolve(undefined)
    },
  }
  const launch = async () => browser
  const omowright = guardOmowright(
    {
      connectPipe: launch,
      connectCloakProfile: launch,
      connectBrowserSkill: launch,
      connect: launch,
      createNetworkSnoop: () => ({ waitFor: () => response.promise }),
    },
    { env: {} },
  )
  return { omowright, command, response, closed, closeCount: () => closeCount }
}

async function expectExpiry(closed: Promise<undefined>) {
  const deadline = new AbortController()
  try {
    expect(await Promise.race([closed.then(() => "closed"), wait(2000, "timed out", { signal: deadline.signal })]))
      .toBe("closed")
  } finally {
    deadline.abort()
  }
}

test("#given pending browser work #when the command finishes #then expiry closes exactly once", async () => {
  const run = fixture()
  const browser = await run.omowright.connectPipe({ idleTimeoutMs })
  const result = browser.cdp.send()
  try {
    await wait(idleTimeoutMs * 2)
    expect(run.closeCount()).toBe(0)
    run.command.resolve("page response")
    expect(await result).toBe("page response")
    await expectExpiry(run.closed.promise)
  } finally {
    await browser.close()
  }
  expect(run.closeCount()).toBe(1)
})

test.each(["page event", "network snoop"] as const)(
  "#given a pending %s wait #when it resolves #then the idle countdown starts",
  async (waitType: "page event" | "network snoop") => {
    const run = fixture()
    const browser = await run.omowright.connectPipe({ idleTimeoutMs })
    const page = await browser.newTab()
    const response = waitType === "page event" ? page.waitForResponse() : run.omowright.createNetworkSnoop(page).waitFor()
    try {
      await wait(idleTimeoutMs * 2)
      expect(run.closeCount()).toBe(0)
      run.response.resolve(200)
      expect(await response).toBe(200)
      await expectExpiry(run.closed.promise)
    } finally {
      await browser.close()
    }
  },
)

test("#given exempt and explicitly closed browsers #when the deadline passes #then neither is reaped", async () => {
  const headed = fixture({ headless: false })
  const borrowed = fixture({ owned: false })
  const attached = fixture()
  const named = fixture()
  const optedOut = fixture()
  const stopped = fixture()
  const browsers = await Promise.all([
    headed.omowright.connectPipe({ idleTimeoutMs }),
    borrowed.omowright.connectPipe({ idleTimeoutMs }),
    attached.omowright.connectBrowserSkill(),
    named.omowright.connectCloakProfile({ name: "test", idleTimeoutMs }),
    optedOut.omowright.connectPipe({ idleTimeoutMs: 0 }),
  ])
  const stoppedBrowser = await stopped.omowright.connectPipe({ idleTimeoutMs })
  try {
    await stoppedBrowser.close()
    await wait(idleTimeoutMs * 2)
    expect([headed, borrowed, attached, named, optedOut].map((run) => run.closeCount())).toEqual([0, 0, 0, 0, 0])
    expect(stopped.closeCount()).toBe(1)
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()))
  }
})

test("#given an owned connection #when browser teardown fails #then the pipe still closes", async () => {
  const run = fixture({ failClose: true })
  const browser = await run.omowright.connectPipe({ idleTimeoutMs })
  await expect(browser.close()).rejects.toThrow("page teardown failed")
  await expectExpiry(run.closed.promise)
})
