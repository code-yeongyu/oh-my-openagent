# Light search: the lookup that is not a research run

A question that needs one fact from outside the repository ("what is the latest React version", "React 19 새 기능 찾아봐", "is this API deprecated") is answered with a short lookup, and this file is the whole discipline for it. A research run (the rest of this skill) starts only on the explicit request named in Activation. Nothing here spawns a team, opens a journal, or writes a report.

## 1. Classify the target before touching a tool

Name which of the three the question is about, then use that tool and only that tool. State the classification in one clause when you answer.

| Target | Tell | Tool |
|---|---|---|
| Public or current fact: a release, a price, a date, news, a product status | the answer lives on the web and can change | web search, then open the source |
| Library, framework, or API behavior | the answer lives in official documentation | official docs or the documentation retrieval path first, web search second |
| This repository's code, logs, or config | the words name a file, a function, a log line, a setting | file search (`rg`, `rg --files`, the LSP, `ast-grep`); never the web |

"How does this system work" (로직 파악, 뜯어봐) is a reading task over the code, not a lookup; the `debugging` skill owns it, and the web supplies only its external evidence (docs, advisories, prior write-ups). A bare "검색" with no file and no web target gets one short clarifying question before any tool runs. Do not chain web to docs to grep silently; a wrong classification is corrected out loud.

## 2. Rewrite the question into 1-3 keyword queries

The sentence the user typed is not a query. Strip the filler ("좀 알아봐 줄래", "can you find out"), keep every anchor verbatim (entity, version string, date, locale, source hint such as 공식, official, GitHub, docs), and write one to three queries that cover the distinct facets of the ask. Korean-market facts are queried in Korean; upstream library facts are queried in English against official sources. Time-sensitive questions carry a recency anchor (the year, "latest", "changelog", "release notes").

Example: "리액트 19 새로운 기능 좀 정리해줘" becomes `React 19 new features`, `React 19 release notes official`, and `react.dev React 19 changelog`.

## 3. A snippet is a candidate, not an answer

Search results find where a fact might live. They do not settle it. When the answer depends on recency, a version, a number, or who said it, open the page and read the claim in the source. Confirm four things before you quote it: the URL, who publishes it, the date on the page (or that there is none), and whether a second source agrees. A matching title, an RSS entry, or a navigation shell with the claim missing is not confirmation; try another rendering path (the `ultimate-browsing` skill for blocked, JS-rendered, or PDF sources), and when no path shows the claim, say it is unverified. Never invent a URL.

## 4. Stop when the fact is in hand

Stop as soon as a primary source confirms the answer, every candidate is dead, or the question needs the user. Write the answer with its date and source. Do not escalate a single-fact lookup into parallel workers, and do not start a research run because a lookup took two queries; a research run begins only when the user asks for one, and Activation above names the words that do.
