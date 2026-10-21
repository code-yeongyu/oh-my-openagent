# Telemetry

OmO can send anonymous usage data so we can see which features people use and what breaks. It is **off by default**: nothing is sent until you say yes. OmO works the same either way.

## Turning it on

The first time you run `omo` interactively, it asks:

```
Anonymous usage stats help us focus work — turn them on? [y/N]
```

Your answer is saved on this machine at `~/.omo/state/telemetry.json`, readable only by you. Every later run reads that answer and never asks again.

You can also turn it on from the environment at any time, which overrides a saved "no":

```bash
OMO_SEND_ANONYMOUS_TELEMETRY=1 omo
```

The "never send anything" switches always win over both.

## What is sent

- the app version, operating system, CPU type and core count, and time zone
- whether a session ran in OmO Desktop or the command line
- which provider and model ran, when they are ones OmO ships; anything else is sent as `custom`
- rough sizes instead of exact numbers, such as a prompt length bucket or a memory size bucket
- token counts and cost for each turn and each delegated task
- which built-in skills, agents and features were used, and whether a message used a [keyword](keywords.md)
- crash reports: which part of OmO stopped, its version, and how long it had been running

## What is never sent

- your prompts or the model's replies
- code, diffs, file names, file paths or folder names
- repository, branch or project names
- commands you ran, logs, or error messages
- account names, emails or keys
- screenshots, window titles or typed text from computer use
- the names of your own skills, providers or models

## How you are counted

OmO creates a random install id on your computer and stores it there. It is not built from your name, hardware or accounts. Each computer is also identified by a one-way hash of its name; the name itself is never sent. Session ids are scrambled on your computer before they are sent, so sessions can't be matched across machines. No personal profile is built. The service that receives the data may work out an approximate country from the connection.

## Turn it off

Answering `n` at the first-run prompt, or setting `enabled` to `false` in `~/.omo/state/telemetry.json`, keeps it off. You can delete that file to be asked again.

In OmO Desktop, choose **Turn telemetry off** when the telemetry notice first appears.

Anywhere, add this to `~/.omo/omo.jsonc`:

```jsonc
{
  "telemetry": { "enabled": false }
}
```

Setting `DO_NOT_TRACK=1`, `OMO_DISABLE_TELEMETRY=1` or `OMO_DISABLE_POSTHOG=1` in your environment turns it off no matter what the answer file or the other flags say. Turning telemetry off stops all of it, including crash reports.

## The full list

Every event and every value OmO can send is listed in the [telemetry reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/senpi-telemetry.md). A test fails if that list and the code disagree.
