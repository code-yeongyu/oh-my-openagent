import { clearTimeout, setTimeout } from "node:timers"

const DEFAULT_IDLE_TIMEOUT_MS = 120_000
const MAX_IDLE_TIMEOUT_MS = 2_147_483_647
const activityByTransport = new WeakMap()
const PAGE_WAITS = [
  "waitForEvent", // Also used by waitForResponse and waitForRequest.
  "waitForLoadState",
  "waitForURL",
  "waitForTimeout",
  "goto",
  "goBack",
  "goForward",
  "reload",
  "setContent",
]

export function trackOwnedBrowserHelper(create, method) {
  return (owner, ...args) => {
    const helper = create(owner, ...args)
    const track = activityByTransport.get(owner?.cdp)
    if (track) helper[method] = track(helper[method].bind(helper))
    return helper
  }
}

export function withOwnedBrowserIdleTimeout(launch, { skipNamed = false } = {}) {
  return async (options = {}) => {
    const { idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, ...launchOptions } = options
    if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 0 || idleTimeoutMs > MAX_IDLE_TIMEOUT_MS) {
      throw new RangeError(`idleTimeoutMs must be an integer between 0 and ${MAX_IDLE_TIMEOUT_MS}`)
    }
    const browser = await launch(launchOptions)
    if (!idleTimeoutMs || (skipNamed && launchOptions.name !== undefined) || !browser.browserProcess) return browser
    const cdp = browser.cdp
    if (!cdp.isHeadless) return browser

    const close = browser.close.bind(browser)
    const pages = new WeakSet()
    let pending = 0
    let timer
    let closing

    const arm = () => {
      if (pending !== 0 || closing !== undefined) return
      timer = setTimeout(() => {
        browser.close().catch((error) => console.warn("OmO could not cleanly close an idle headless browser:", error))
      }, idleTimeoutMs)
      timer.unref()
    }

    const track = (operation) => async (...args) => {
      clearTimeout(timer)
      pending++
      try {
        return await operation(...args)
      } finally {
        pending--
        arm()
      }
    }
    activityByTransport.set(cdp, track)
    // Commands share this transport, but page waits can outlive their last command.
    cdp.send = track(cdp.send.bind(cdp))
    browser.newTab = track(browser.newTab.bind(browser))
    const attachPage = browser.attachPage.bind(browser)
    browser.attachPage = track(async (...args) => {
      const page = await attachPage(...args)
      if (!pages.has(page)) {
        for (const method of PAGE_WAITS) page[method] = track(page[method].bind(page))
        pages.add(page)
      }
      return page
    })
    browser.close = () => {
      clearTimeout(timer)
      closing ??= close().catch(async (error) => {
        // A page teardown can fail before BrowserConnection.close reaches the owned pipe.
        try {
          await cdp.close()
        } catch (fallbackError) {
          throw new AggregateError([error, fallbackError], "Owned browser and pipe teardown both failed")
        }
        throw error
      })
      return closing
    }
    arm()
    return browser
  }
}
