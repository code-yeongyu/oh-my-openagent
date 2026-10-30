# Telemetry

OmO sends pseudonymous usage data so we can see which features people use and what breaks. It is on by default, you can turn it off at any time, and OmO works the same either way. Who receives the data, how long it is kept, and how to have it deleted are in the [privacy policy](../legal/privacy-policy.md).

## What is sent

- the app version, operating system and its version, CPU type and core count, and time zone
- once a day per product, an activity event that also carries the CPU model name, total memory, locale, the name of your login shell program (for example `zsh`, never its path), and the terminal application name
- whether a session ran in OmO Desktop or the command line
- which provider and model ran, when they are ones OmO ships; anything else is sent as `custom`
- which of OmO's built-in providers you have signed in to or configured, and how many accounts each has, as counts capped at "10 or more"; never an account name, email or key
- which built-in model each of OmO's built-in categories is set to; a model OmO does not ship is sent as `custom`
- rough sizes instead of exact numbers, such as a prompt length bucket or a memory size bucket
- token counts and cost for each turn and each delegated task
- which built-in skills, agents and features were used, and whether a message used a [keyword](keywords.md)
- crash reports: which part of OmO stopped, its version, the exit code or signal, and how long it had been running

## What is never sent

- your prompts or the model's replies
- code, diffs, file names, file paths or folder names
- repository, branch or project names
- commands you ran, logs, or error messages
- account names, emails or keys
- screenshots, window titles or typed text from computer use
- the names of your own skills, providers or models

## How you are counted

OmO creates random, pseudonymous install ids on your computer and stores them there; only a one-way hash of an id is sent. They are not built from your name, your computer's name, hardware or accounts. Session ids are scrambled on your computer before they are sent, so sessions can't be matched across machines. No personal profile is built. The data goes to PostHog, Inc. in the United States, which works out an approximate country from the connection and then discards the address.

## Turn it off

In OmO Desktop, choose **Turn telemetry off** when the telemetry notice first appears.

For OmO Native (the CLI and the Desktop runtime), add this to `~/.omo/omo.jsonc`:

```jsonc
{
  "telemetry": { "enabled": false }
}
```

For the OpenCode plugin, add `"[opencode]": { "telemetry": false }` to the same file. The Codex adapter is turned off only by the environment variables below.

Setting `DO_NOT_TRACK=1`, `OMO_DISABLE_TELEMETRY=1`, `OMO_DISABLE_POSTHOG=1` or `OMO_SEND_ANONYMOUS_TELEMETRY=0` in your environment turns it off in every product. OmO Native is also off automatically in CI and test runs. Turning telemetry off stops all of it, including crash reports, and changes nothing else about how OmO behaves. To have events that were already sent deleted, see "Your rights" in the [privacy policy](../legal/privacy-policy.md).

## The full list

Every event and every value OmO can send is listed in the [telemetry reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/senpi-telemetry.md). A test fails if that list and the code disagree.
