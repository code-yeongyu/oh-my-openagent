---
name: browser
description: "Drives a real browser through the omowright library from the js eval kernel: sites the user is already signed into, forms and clicks, JS-rendered pages, screenshots, web QA, extension popups, a human handoff for login, CAPTCHA or OTP, and a browser you own for scraping, bot-scored targets, network capture and QA traces. Use for any interactive browser task; not for a plain search or an unblocked static fetch."
---

# Browser

One library, two engines. omowright ships inside this skill; choose the engine before you act:

| You need | Engine | Entry point |
|---|---|---|
| A site the user is signed into, their open tabs, a form, a click-through, a screenshot, web QA, an extension popup | **attached** — the user's own browser through BrowserSkill | `connectBrowserSkill()` |
| A throwaway profile, bot-scoring evasion, a CAPTCHA, network interception, a QA flight trace, coordinate control, headless runs | **owned** — a browser your code launches | `connectPipe()` / `connectCloakProfile()` — [references/owned-engine/README.md](references/owned-engine/README.md) |
| Text out of a URL, a 403 bypass, a platform that blocks fetchers | neither | the `ultimate-browsing` skill |

**Attached is the default,** because it is the only engine carrying the user's logins and the only
one where a human is a single call away. Never substitute one engine for the other silently: if
the attached engine is not set up, run the onboarding script and tell the user its one remaining
step.

## Step 0 — which engine this session is allowed to use

When `OMO_BROWSER_ENGINE` is set (the OmO desktop app sets it for every session), it wins over the table above:

| Value | What you do |
|---|---|
| `connected` | Use `connectBrowserSkill()` only. If the user's browser is not connected you get a "Connect your browser" error: relay it and stop. Never open another browser |
| `builtin` | Do not call `connectBrowserSkill()`; use the app's in-app browser tools |
| `none` | Do not do browser work. Say that agent browser access is off for this project |
| unset | The table above, as before (terminal use) |

While any engine is set, `loadOmowright()` returns a guarded library. The owned engine (`connectPipe`,
`connectCloakProfile`, `connect`) and every other export that acts on a browser is refused, so the table above
does not apply: do not look for a way around it, and tell the user what the session allows. Under `connected`
the app sees what the browser is doing, and before a click, Enter or script that sends, posts, pays, orders,
subscribes, deletes or closes an account, and before Enter in a message box, it asks the user first. A "No" fails the action with
`BrowserActionDeclinedError`: report that, never retry it or go around it (`session.tool()` lets only reads
through; `evaluate` is guarded too). If the user presses Stop, the next call throws `BrowserUserStoppedError`: tell
the user browser use was stopped and start no new session this turn.

The guard prevents mistakes by a cooperating agent. It is not a security boundary: code that imports the raw
entry (`resolveOmowrightEntry()`) is not guarded, and a host without the `omo_browser_bridge` tool cannot show state or
honor Stop, though questions are still asked.

## Step 1 — load omowright and prove the stack

```js
const { loadOmowright } = await import("<skill-root>/scripts/omowright.mjs")
const { omowright } = await loadOmowright()          // { connectBrowserSkill, bskSnapshot, connectPipe, ... }
```

```bash
node "<skill-root>/scripts/browser-doctor.mjs" --json
```

| State | Meaning | Next |
|---|---|---|
| `ready` | CLI, daemon and a connected browser | start a session |
| `no-cli` / `no-daemon` / `no-extension` | something is missing | `node "<skill-root>/scripts/browser-install.mjs" [--browser=<id>]` prepares everything it can for **the browser the user uses**, then prints the **single** step only the user can do (relaunch that browser and click **Enable**); relay it verbatim, wait, re-run the doctor |
| `choose-browser` | the signals do not single out one browser (Safari/Firefox default, an idle default while another browser runs, several in use) | nothing was installed; take the browser from memory or ask the user, then `browser-install.mjs --browser=<id>` |
| `no-browser-support` | no Chromium-family profile on this machine | say so and stop |

**Install into the browser the user actually uses, never into whatever happens to be on disk.** Before
installing, check your memory for the user's browser; otherwise read the doctor's `browser` (picked
from the OS default browser, running apps and recent use — `candidates` shows the evidence). If memory
and the doctor disagree, or the doctor says `choose-browser`, ask the user. Pass the answer as
`--browser=<id>` and record it in memory. A Chrome that is merely installed is not their browser.

**Never launch a headless browser because the attached one is missing.** It has none of the
user's sessions, so every login turns into a ladder you should not be climbing. Say which state
you hit and ask.

## The loop (attached)

```js
const session = await omowright.connectBrowserSkill({ name: "<task>", focused: false })
try {
  await session.navigate("https://example.com/", { waitUntil: "load" })
  const { tree, refs, css } = await omowright.bskSnapshot(session, { interactive: true })  // OmOWright tree + refs, no trace in the page
  await session.click({ selector: css.e3 })                                                 // css[ref] is null inside shadow roots:
  const vom = await session.observe({ maxTokens: 4000 })                                    //   then read the daemon's own tree ...
  await session.click("@e7")                                                                //   ... and click its @eN ref
  await session.fill(css.e5, "hello")
  await session.press("Enter")
  await session.waitForNavigation({ waitUntil: "load" })
  const shot = await session.screenshot()                                                   // { buffer, width, height, captureId }
} finally {
  await session.stop()                                                                      // success AND failure; returns borrowed tabs
}
```

1. **Read before every action.** `bskSnapshot` refs and `observe` `@eN` refs are reissued on each
   call; use a ref in the same cycle you read it.
2. **Navigation and large DOM changes stale every ref.** Read again rather than reusing.
3. **Two identical failures mean change approach, not retry.** A third identical attempt is a defect.
4. **Borrow a user tab explicitly** (`tabList({ scope: "user" })`, `tabBorrow(id)`, `tabReturn(id)`).
   Borrowing prompts the user; never invent tab ids and never repeat a denied borrow.
5. **Always `stop()` the session,** on success and on failure.

Every method, its options, and the failure codes are in [references/commands.md](references/commands.md).

## When a human is the only way through

Login, CAPTCHA, OTP, a payment confirmation, a consent dialog:

```js
const outcome = await session.requestHelp({ prompt: "<what you need done>", targets: ["@e4"], timeoutMs: 300_000 })
```

Then read the page again. Respect a `cancelled` or `timed_out` outcome; do not work around it by
changing the extension's automation settings.

## Rules

- **Never read credentials through the page.** No `evaluate` that extracts a password, token,
  cookie or recovery code. The value of the attached engine is that the browser is already signed in.
- **Never clear cookies, cache or site data.** It is the user's real profile; clearing it logs them
  out everywhere. No flow here needs it.
- **`focused: false` by default.** The browser belongs to someone who is probably using it.
- **One short, named session per task,** always stopped.
- **Bot-scored or WAF targets go to the owned engine** (not while `OMO_BROWSER_ENGINE` is set: then say the site needs a browser the session does not allow). The attached engine's daemon enables console
  capture on every tab it drives, which is a known automation signal; CloakBrowser through
  `connectCloakProfile()` is the stealth path.

## Where the rest lives

| Topic | Read |
|---|---|
| Session methods, targets, options, error codes | [references/commands.md](references/commands.md) |
| Installing: CLI, daemon, extension, the one human step, blocklisted extension | [references/install.md](references/install.md) |
| Agent on one machine, browser on another | [references/remote.md](references/remote.md) |
| Owned engine: launch, snapshot ladder, network, frames, human handoff | [references/owned-engine/README.md](references/owned-engine/README.md) |
| Reading a 1Password vault the user has unlocked | [references/recipes/1password.md](references/recipes/1password.md) |
