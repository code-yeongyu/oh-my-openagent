# Side panel: subscription usage section

Branch `feat/senpi-side-panel-usage`, on top of `feat/senpi-side-panel`. No PR yet.

This is the part deliberately left out of PR #8092: the only piece of the panel that leaves the
machine. The config surface (`side_panel.sections.usage`, `side_panel.usage_poll_seconds`) shipped
with that PR; this branch fills it in.

## WHAT IT DOES

Polls the two subscription endpoints the vendors publish - `api.anthropic.com/api/oauth/usage` and
`chatgpt.com/backend-api/wham/usage` - for the account the session is actually serving from, and
draws one bar per rolling window. The bar carries a marker at the point an evenly paced burn would
have reached, which is what turns "65%" into "65% and the window still has an hour to run".

Nothing is constructed when `sections.usage` is off: no credential read, no timer, no request.

## THE DECISIONS WORTH REVIEWING

- **One decision produces the token, the on-screen name and the cache key** (`usage/accounts.ts`).
  Deriving them separately is what lets a panel print one account's name over another account's
  quota; the prototype did exactly that and it was a real bug.
- **The cache is machine-wide, not per session** (`$XDG_CACHE_HOME/omo-senpi/side-panel-usage.json`).
  A quota belongs to an account, so N sessions polling independently would multiply requests
  against that same quota. Freshness, the shared backoff and a 30s "fetch announced" claim are all
  decisions over that one file, and it is validated on read because sibling sessions and older
  versions write it too.
- **A failure never blanks the section**: the previous bars stay with their age, and the reason
  joins them as a dim line with its retry deadline.
- **Short tokens are never sent.** senpi's generic key resolver hands back a short internal marker
  for `claude-sdk-oauth`; Anthropic answers that malformed bearer with a 429 carrying a 48-minute
  retry-after, which is a self-inflicted outage. Anything under 40 characters is refused locally.
- **A stale token is still sent.** The endpoint's 401 is what lets the column say
  "auth stale - run /login"; staying silent explains nothing.

## GATES

- `bun run test:senpi` - exit 0, 3,404 tests, 0 fail (44 of them new).
- `tsgo --noEmit` - clean.
- Extension bundle 1,122,399 bytes against the 1,150,000 budget.
- Hostless tests never reach the network: the component test factory turns `sections.usage` off,
  and the tests that exercise it inject their own fetch, credential reader and cache path.

## LIVE RUN (real account, real endpoints)

Right-hand column of a 200x50 capture, `--tui-mode fullscreen`:

```
USAGE  0s ago
claude
5h      ██████████████████▎░░░┊░░░░░  65%  58m
7d      ████▌┊░░░░░░░░░░░░░░░░░░░░░░  16%  Wed 08:00
Fable   ░░░░░┊░░░░░░░░░░░░░░░░░░░░░░   0%  Wed 08:00
account work
codex
5h      ▌░░░░░░░░░░░░░░░░░░░░┊░░░░░░   2%  1h09
7d      █▏░░░░░░░┊░░░░░░░░░░░░░░░░░░   4%  Tue 09:12
```

Both providers answered, the scoped weekly limit is labelled with its model, the pace markers (`┊`)
sit where an even burn would be, and the account the numbers belong to is named under them.

## WHAT THE LIVE RUN CAUGHT

The first live capture had ragged bars, because each row sized its own bar from the width of its
reset label - a countdown ("58m") and a weekday clock ("Wed 08:00") produced bars four cells apart
and percentages that did not line up. The tail is now computed once for the whole section and the
reset labels are padded to a shared column. `sections/usage.test.ts` pins it: the `%` sits at the
same index in every row.
