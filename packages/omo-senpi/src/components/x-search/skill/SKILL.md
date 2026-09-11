---
name: x-search
description: "MUST read before searching X/Twitter with the x_search tool. When xAI is connected: date-bound every time-sensitive query (from_date >= yesterday, widen to 7 days), scope trusted accounts with allowed_x_handles, phrase queries as latest/recent with since:/from:/filter: operators, split into 2-3 searches by account and by keyword, and reconcile against web_search. Triggers: X search, Twitter search, tweets, posts on X, what people are saying on X, x_search, social signal."
---

# x-search: searching X (Twitter) through xAI

This skill only matters when an xAI account is connected. The `x_search` tool
is registered at load time if a credential exists, and it is hidden behind
`tool_search` until you activate it. Everything below assumes you've read the
current date from the system prompt; never hardcode a date.

## Which tool

1. Run `tool_search "X posts"`. If `x_search` shows up, it's callable on the
   next turn.
2. If nothing matches, xAI isn't connected. Say so plainly ("x_search is
   unavailable, no xAI credential") and fall back to `web_search`. Don't guess
   at tweets from memory.

`x_search` is one round trip to xAI's server-side X tools (keyword search,
semantic search, user search, thread fetch). You don't pick the sub-tool; the
server does. Your job is to shape the query and the parameters so the server
lands on the right one.

## The 4 rules

1. **Date-bound anything time-sensitive.** Stocks, earnings, market reaction,
   foreign flows, breaking news, product launches: compute yesterday from
   today's date and pass it as `from_date`. Start narrow. If the first pass
   comes back thin, widen to 7 days. Dates are inclusive on both ends.
2. **Scope trusted accounts.** When the user names accounts they trust, pass
   them as `allowed_x_handles` (bare handles, no `@`, max 20). Example:
   `["growth_papa", "aleabitoreddit"]`. `allowed_x_handles` and
   `excluded_x_handles` are exclusive; pick one.
3. **Phrase for recency.** Write the query the way X advanced search expects:
   "latest" or "recent" wording plus operators (`since:`, `until:`, `from:`,
   `filter:links`, `-filter:replies`, `lang:`). The server has been observed
   running keyword search in Latest mode when the query carries `since:`.
4. **Split, don't stack.** One mega-query returns mush. Run 2 to 3 narrower
   searches: one pass by account, one by keyword, and a thread fetch when a
   single post needs its replies. Each call is one search turn.

## Operator cheat sheet

| Operator | Meaning | Example |
|----------|---------|---------|
| `since:YYYY-MM-DD` | posts on or after the date | `since:2026-09-02` |
| `until:YYYY-MM-DD` | posts on or before the date | `until:2026-09-03` |
| `from:handle` | posts by one account | `from:growth_papa` |
| `filter:links` | only posts with links | `earnings filter:links` |
| `-filter:replies` | drop replies | `NVDA -filter:replies` |
| `lang:xx` | language code | `lang:ko`, `lang:en` |
| `"exact phrase"` | literal match | `"foreign net buying"` |

Operators live inside `query`. `from_date` / `to_date` / `allowed_x_handles`
are separate parameters and are the reliable half; operators nudge the server,
parameters bind it. Use both when they agree.

## Split-search recipe

Run these as separate `x_search` calls, not one combined query.

**Handle pass.** Trusted accounts, narrow window.
```
query: "latest on <topic> since:<yesterday>"
allowed_x_handles: ["growth_papa", "aleabitoreddit"]
from_date: <yesterday>
```

**Keyword pass.** Open field, reply noise removed.
```
query: "recent <topic> <ticker or key term> -filter:replies lang:en"
from_date: <yesterday>
```

**Thread-fetch pass.** Only when one post from the passes above needs context.
```
query: "<x.com URL of the post> replies and quotes"
```

Stop after three passes unless the user asks for more. If the handle pass and
the keyword pass disagree, report both rather than averaging them.

## Reading results

Each result arrives as a URL plus a one-line summary, followed by a
`Queries used:` trailer that lists the exact queries the server ran. Keep the
trailer in your notes; it's the only provenance you have for what was actually
searched.

When you report:

- Cite the `x.com` URL for every claim drawn from a post.
- Label the source as an X post. A tweet is a signal that someone said
  something, not a verified fact. Say "posted on X by @handle" rather than
  stating the content as true.
- Quote sparingly. Summaries in your own words plus the link do the job.

## Tandem with web_search

Run the same topic through `web_search` in the same turn. Then reconcile:

- Web-found event with no X echo: say so. It may be too fresh, too niche, or
  the query missed it.
- X-only claim with no web coverage: say so, and flag it as unconfirmed.
- Both agree: cite both, X for the reaction, web for the record.

Don't let an X-only claim into a conclusion without that note.

## Cost note

xAI bills X search at $5 per 1,000 calls. One `x_search` call is one search
turn. The three-pass recipe costs roughly $0.015. That's cheap, but it isn't
free, so don't loop on retries when the first pass came back empty; widen the
window once, then stop.

## Backtest pointer

Query recipes and parity against other lanes are checked by
`packages/omo-senpi/scripts/qa/x-search-backtest.mjs`. If you change a rule in
this skill, update the query set there so the backtest still reflects the
recipe it's measuring.
