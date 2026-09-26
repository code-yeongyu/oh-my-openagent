> [!NOTE]
> **OmO 5.0: OmO ❤️ Pi**
> Install it with `bun add -g omo-ai`. Memory system, CodeMode, Anthropic subscriptions, all covered.
> [![OmO Herdr DAG - live OmO workflow DAGs in a Herdr side pane](./.github/assets/omo-herdr-dag.png)](https://github.com/jc01rho/omo-herdr-dag)
> *Just type "mass ulw" with your prompt - now you are the master of graph engineering. Multi-model ultracode, together with a better memory system. (The right panel is [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag).)*

> **Sponsors**
> These are our sponsors. They help keep OmO going as a personal side project.
> | [<img alt="OpenGateway" src="./.github/assets/opengateway-logo.svg" width="156px" />](https://opengateway.ai/) | **[OpenGateway](https://opengateway.ai/)** sponsors OmO. An OpenAI-compatible gateway that puts many model providers behind one API. Thank you for backing open source. |
> | :-----| :----- |


> [!NOTE]
>
> [![Sisyphus Labs - Meet Dori. Not a demo. Subscribes to everything.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
> > **OmO is maintained by Jobdori, the AI assistant shown above. Meet your own Jobdori, Dori. <br />Join the waitlist [here](https://sisyphuslabs.ai).**

> [!TIP]
> Be with us!
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | Join our [Discord community](https://discord.gg/PUwSMR9XNk) to connect with contributors and fellow OmO users. |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | Updates for OmO used to be posted on my X account. <br /> Since it was mistakenly suspended, [@justsisyphus](https://x.com/justsisyphus) now posts updates on my behalf. |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | Follow [@code-yeongyu](https://github.com/code-yeongyu) on GitHub for more projects. |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://omo.dev"><img src="./.github/assets/omo-icon-light.svg" alt="OmO" width="200" /></a>

# OmO

**Your tool for real work. But it's an agent.**

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![npm downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fomo.dev%2Fapi%2Fnpm-downloads&style=flat-square)](https://www.npmjs.com/package/omo-ai)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-omo.dev-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.dev/docs)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md) | [Русский](README.ru.md)

</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

OmO is one `omo` command that turns your tokens into finished work: research across ten thousand sources, a deck people actually get, backends, frontends, code. It runs on senpi, our fork of [pi](https://github.com/badlogic/pi-mono), with everything below built in.

## Install

```bash
bun add -g omo-ai
omo
```

No bun? `npm i -g omo-ai` works too. The package is `omo-ai`; the unrelated `omo` package on npm is someone else's.

Open your project, run `omo`, describe the job. That's the whole setup.

Coming from the OpenCode edition or LazyCodex? Run `omo setup` once. It carries your provider keys, custom providers, MCP servers, skills and model picks across. `omo doctor` then shows which task categories your providers can run and what the old install left behind. The full walkthrough is [Migrating from OpenCode](docs/guide/migrating-from-opencode.md).

`omo update` updates in place. `bun remove -g omo-ai` (or `npm uninstall -g omo-ai`) removes it.

## Why OmO

**ultrawork.** Skip the study. If a task feels hard, add `ultrawork` (or `ulw`) to your prompt. The agent reads the codebase before touching a line, plans, proves each step before moving on, checks the result on the real surface, and stops when it's done.

**Hundreds of agents, one keyword.** Type `mass ulw` and the whole job becomes a graph of agents: deep research over thousands of sources, a full machine-learning pipeline, a migration nobody wants to do. Each part runs on the model that fits it, in parallel, and gets checked before anything is called done.

**Kibitzer. Your agent doesn't forget you, or your work.** Memory lives in a git repository of markdown files. A small, cheap model sits beside the expensive main agent, reads what you've done before, and nudges the main agent before it repeats a mistake. You stop re-explaining yourself.

**Mix models without thinking about it.** Use the frontier models you love together with the cheap ones. Just sign in: `/login` covers Claude, ChatGPT, Kimi and GLM subscriptions. Every model ships with a system prompt tuned for it, so you never pick the wrong one.

**High-quality skills, only the ones you need.** Your model is smart, but it still doesn't know a lot about solving real-world problems. OmO ships the missing knowledge as skills, browser use included, and loads only what the task needs.

**Everything else is crafted.** Independent tool calls run together in one small program, so twenty reads are one round trip. Malformed tool arguments are repaired before they run. Waiting on a build or a deploy is a subscription, not polling. Long work keeps a record of what was checked, so a restarted session picks up where it stopped. Config, skills and prompts reload live.

## Configuration

Opinionated defaults, adjustable if you insist. Your settings live in `~/.omo/omo.jsonc`, and a project can add its own `.omo/omo.jsonc`; the closest file wins. Every key is in the [configuration reference](docs/reference/configuration.md).

## Docs

- [omo.dev/docs](https://omo.dev/docs)
- [Migrating from OpenCode](docs/guide/migrating-from-opencode.md)
- [Configuration reference](docs/reference/configuration.md)
- [Features](docs/reference/features.md)
- [Ultrawork Manifesto](docs/manifesto.md)

## Reviews

> "It made me cancel my Cursor subscription. Unbelievable things are happening in the open source community." - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> "If Claude Code does in 7 days what a human does in 3 months, OmO does it in 1 hour." <br/>- B, Quant Researcher

> "You guys should pull this into core and recruit him. Seriously. It's really, really, really good." <br/>- Henning Kilset

## Author's Note

When I have to take the wheel back from an agent, that isn't teamwork. The system failed. OmO is built on that idea. You say what you want; the agent researches, plans, writes code you couldn't tell from a senior engineer's, verifies it, and keeps going until it's finished. It spends tokens when they buy real speed and routes the easy parts to cheap models.

I'm this project's most obsessive user. Which model has the sharpest logic? Who writes the best prose? What did everyone else ship this week? OmO is where those answers land. Have a better way? PRs welcome.

The goal is an agent you stop noticing. You flip the switch, the light turns on. The long version is the [Ultrawork Manifesto](docs/manifesto.md).

No affiliation with any project or model mentioned. The Ultragoal and UltraQA ideas come from [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), reimplemented from concept for OmO.

## Loved by professionals at

[Indent](https://indentcorp.com), makers of Spray (influencer marketing solution), vovushop (cross-border commerce platform) and vreview (AI commerce review marketing solution). [Google](https://google.com). [Microsoft](https://microsoft.com). [Vercel](https://vercel.com). [ELESTYLE](https://elestyle.jp), makers of elepay (multi-mobile payment gateway) and OneQR (mobile application SaaS for cashless solutions). [Deepgram](https://deepgram.com).
