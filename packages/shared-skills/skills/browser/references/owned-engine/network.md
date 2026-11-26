# Read the network, not the DOM

When a page renders a list, a table, or search results, the data almost always arrived as JSON one
request earlier. That JSON is complete, typed, free of markup, and immune to the layout changing
next week. Watching traffic costs nothing on a target you own, and the page cannot observe it.

**Snoop before you scrape.** Scroll-and-parse is the fallback, not the default.

```js
// given: omowright, page, url
const snoop = omowright.createNetworkSnoop(page, { maxBodyBytes: 512 * 1024 })
const [hit] = await Promise.all([            // subscribe first: waitFor sees only responses that arrive after it
  snoop.waitFor({ url: /\/api\/search/, mimeType: "application/json" }, { timeoutMs: 10_000 }),
  page.goto(url),
])
console.log(snoop.summary({ max: 20 }))      // one line per request: method status mime size url
const rows = snoop.popJson()                 // every buffered JSON body, drained
// snoop stays subscribed for the next example; when you are done with this page's traffic: snoop.dispose()
```

## Wait for a request, never for a clock

A fixed sleep is a guess that fails on a slower machine and wastes time on a faster one.
`snoop.waitFor(match)` subscribes to the response you expect **before** you trigger the action,
then awaits it with a bounded timeout. This is the same rule that governs test code, for the same
reason.

## Collecting through infinite scroll

```js
const items = []
for await (const item of omowright.collectWhileScrolling(page, snoop, { minItems: 200, maxScrolls: 10, extract: (json) => json.items })) {
  items.push(item)                           // one extracted item per iteration; an item the API sends twice arrives twice
}
snoop.dispose()                              // unsubscribe once the collection is over
```

Scroll, collect what is new, stop on a target count or a scroll ceiling. Bound both, so a page
that keeps producing cannot run forever. A round ends when the next response lands; `settleMs`
(default 800) only bounds a round in which nothing arrives, so leave it unset.

## Flight traces

For QA evidence, `createTrace(page, { dir })` records one entry per `trace.step(name, fn)` with
before/after screenshots, the network log and console output, written as `trace.jsonl` plus
`trace.har` (`toHar` builds the HAR from snoop entries). That triple is what makes a failure
reconstructable afterwards instead of re-runnable-in-theory. Call `trace.stop()` in `finally`.

Cap recorded body sizes. An untrimmed trace of a media-heavy page is mostly bytes nobody reads.

## Request interception

`createRoutes(page)` matches by glob, regular expression, or predicate and lets a handler
`continue`, `fulfill({ status, body })` or `abort()`: stub an endpoint, fail one request to test an
error path, block third-party noise. Interception is enabled on the first route and disabled on
`dispose()` — leaving it on slows every later navigation and changes the timing fingerprint, so
prefer passive snooping on bot-scored targets.

## Cookies

`injectCookies(page, cookies)` sanitizes what it injects (drops expired entries, keeps
host-prefixed cookies secure and root-scoped). Injecting an export into your own profile is
legitimate for ordinary sessions and useless for the ones you most want: accounts whose risk
engines bind a session to a device will invalidate it, and a password manager's session is
tab-bound and never portable.

**Never copy a session out of the user's real browser profile.** If you need their login, that is
the attached engine's job.
