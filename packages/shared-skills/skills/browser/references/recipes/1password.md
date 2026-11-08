# Reading a 1Password vault the user has unlocked

Scope: reading an item out of a vault **the user has already unlocked in their browser**. Signing
in is the user's job; see "Not in scope" below.

## The fact that shapes everything

1Password web is zero-knowledge. The unlocked vault key lives in **one tab's `sessionStorage`**,
not in a cookie. So:

- A **new** tab pointed at the vault redirects to the sign-in page even while a signed-in tab sits
  right beside it. Opening your own tab does not work and never will.
- Navigating the authenticated tab away, or closing it, **destroys the session** until a human
  signs in again.

Therefore: borrow the existing tab, read, return it. Do not open, do not navigate away, do not
"refresh to fix" anything.

```js
const { tabs } = await session.tabList({ scope: "user" })          // find the already-signed-in tab by URL
const vault = tabs.find((t) => /my\.1password\.com\/(?:vaults|app)/.test(t.url))
await session.tabBorrow(vault.tab_id)                               // the user confirms
// ... read ...
await session.tabReturn(vault.tab_id)
```

## Check liveness by URL, never by title

The app mutates its URL hash without updating the document title, so a signed-in vault can still
report a sign-in title. A live session's `location.href` contains the app path and never the
sign-in path. Read the URL from `tabList`, or `session.evaluate("location.href")`.

## The browser may be shared

Other automation may be driving the same window.

- **Clear the search box before typing** (`fill(target, value, { clearBefore: true })`). It often
  holds someone else's query, and typing alone appends to it, returning confident results for the
  wrong search.
- **Read the autocomplete listbox, not the results grid.** The grid holds whatever query was last
  committed, possibly by another actor. Scraping every option on the page silently merges two
  different searches.
- **Leave the tab on the item list** when you are done, so the next actor starts clean.

## If it is locked

```js
await session.requestHelp({ prompt: "Please unlock 1Password in this tab, then continue." })
```

Then read the page again.

## Not in scope

- **Do not type a master password, and do not automate the sign-in form.** Only the account owner
  signs in. If the vault is locked, hand it to them.
- **Do not extract secrets through the page** beyond the single value the user asked for, and
  report it masked (`abcd…9fb0 (len 37)`) unless they asked for the exact string.
- **Do not copy, inject, or reuse session cookies.** The session is device- and tab-bound; cookie
  reuse cannot work and trips account protections.
- Clear the clipboard if you ever populate it.
