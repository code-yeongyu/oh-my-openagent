# The built-in browser inside OmO Desktop

When `OMO_BROWSER_ENGINE` is set (the OmO desktop app sets it for every session), both engines work exactly
as in the terminal. The app adds one more option:

| Option | What it is | Use it when |
|---|---|---|
| `connectBuiltinBrowser()` | OmO's built-in browser for this thread: the tab the user sees beside the chat, which they can watch, take over and share | the user should see the page while you work, the task is QA of something in the app, or a sign-in the user should do themselves in a visible tab |

```js
const browser = await omowright.connectBuiltinBrowser()
const [tab] = await browser.listTargets()
const page = await browser.attachPage(tab.id)
await page.goto(url)
```

It is an OmOWright connection like `connect()`. Work in few calls: take `page.snapshot()` once, act on its refs,
and chain several actions in one eval cell (`page.locator(ref).fill()`, `.click()`, `.selectOption(value)`,
`.setInputFiles(path)`), snapshotting again only after the page changed. It has one tab: navigate it rather than
opening new ones. `BuiltinBrowserUnavailableError` permits another engine only for `unavailable`, `timeout`, or
`invalid_grant`. For `user_stopped` or any other app refusal, stop browser work and report it; do not open another browser.
