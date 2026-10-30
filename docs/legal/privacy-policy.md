# Privacy Policy

Last updated: October 28, 2026

This notice explains what the oh-my-openagent project ("OmO") collects from your computer through telemetry and through feedback reports you choose to send, why, who receives it, and what you can do about it. It covers the OmO Native CLI (`omo-senpi`), OmO Desktop, the OpenCode plugin (`oh-my-opencode`), and the Codex adapter (`omo-codex`, published as `lazycodex-ai`). It does not cover GitHub or npm, which host the repository and packages under their own privacy policies, or the model providers you configure yourself, which receive your prompts directly from your computer under their own terms.

This is a notice, not a contract. The [Terms of Service](./terms-of-service.md) are a separate document.

## 1. Who is responsible

The controller (under Korea's Personal Information Protection Act: the personal information controller and privacy officer) is Yeongyu Kim, an individual maintainer. There is no company behind the project and no separate data protection officer.

- Email: code.yeon.gyu@gmail.com
- Private form: https://github.com/code-yeongyu/oh-my-openagent/security/advisories/new (Security tab, "Report a vulnerability")

Use the private form or email, never a public issue, for anything that contains your install id.

## 2. What telemetry sends

While OmO runs, it sends product telemetry to PostHog (section 5). OmO Native events (the CLI and Desktop) are a fixed set of fields, and each field is a boolean, a number, a size bucket, or a value from a published list. The once-a-day activity events described under "About your computer" also carry a few strings as your system reports them (CPU model, terminal application, locale) and the name of your login shell program, cut from its path. The complete, machine-checked list of events and fields is in the [telemetry reference](../reference/senpi-telemetry.md); the Codex adapter's single event is in the [Codex telemetry reference](../reference/codex-telemetry.md). If this notice and those lists ever differ, the lists are authoritative and this notice is wrong.

### Identifiers

- **Install hash.** The first time OmO runs it creates a random install id and stores it in a file on your computer. The id is random: it is not derived from your name, hostname, hardware, or accounts. Only its SHA-256 hash is sent. For OmO Native events this is the only value that links events from the same installation; each product's once-a-day activity event uses its own random install id the same way (section 7). It is pseudonymous: we cannot tell who you are from it, but it does tell one installation from another, so we treat it as personal data wherever the law does.
- **Session hash.** The session id combined with a random per-computer salt, then hashed. Sessions from different computers cannot be matched.
- **Event id.** A random id per event, used only to drop duplicates.

Versions of OmO before this release also sent a one-way hash of your computer's hostname (`machine_hash`, and the identifier of the older daily-active events). This release and later versions send no value derived from the hostname.

### About your computer

- OmO version, which surface ran (CLI or Desktop), and whether the run was in CI
- Operating system and version, CPU architecture and core count, memory size as a bucket, and time zone
- Once a day, each product (OmO Native, the OpenCode plugin, the Codex adapter) also sends an activity event with: package name and version, runtime and its version, operating system name, release, type and architecture, CPU core count and CPU model name as reported by the operating system, total memory in GB, locale, time zone, the name of your login shell program (for example `zsh`, never its path), the terminal application name (`TERM_PROGRAM`, for example `iTerm.app`), and whether the run was in CI

### About your configuration

- Which of OmO's built-in providers and models are configured or set as default, as counts and as names from a fixed list. A provider or model that OmO does not ship, including a self-hosted gateway or a fine-tune, is sent as `custom`.
- How many accounts are linked per built-in provider, as counts capped at "10 or more". Never an account name, email, token, or key.
- Which built-in model each of OmO's built-in categories is set to (custom models as `custom`).

### About usage

- A daily-active ping, at most once per UTC day per installation. The OpenCode plugin and the Codex adapter send only this ping with the device fields above.
- Session starts and session summaries: start reason, root or child session, number of turns, token counts, cost totals, counts of errored and aborted turns, tool result and error counts.
- Per-turn token counts and cost for about 5% of sessions by default (summaries are sent for every session).
- Prompt metadata only: length bucket, whether a keyword was used, how the prompt was submitted. Never the prompt.
- Which built-in skills, agents, categories, and features were used; for each delegated task its outcome, duration, tokens, and cost; counters and timings for parallel tool use and helper agents.
- Computer use: when it was activated, which permission kind was denied, and an error code from a fixed list. Never screen content, window titles, application names, coordinates, or typed text.
- The numbers in a cost hint OmO showed you, whether you accepted it, and whether the estimate was for a subscription plan.

### Crash reports

When an OmO process dies, the next OmO process to start reports it: operating system, architecture, the versions that crashed, exit code or signal, process kind, and uptime. No stack trace, path, prompt, or session content.

### Derived on PostHog's servers

- An approximate country and continent, derived from the IP address of the connection. PostHog is configured to discard the IP address itself, and city, postal code, and coordinate fields are dropped. OmO never writes an IP address into an event and stores none locally. The country can be wrong behind a VPN, proxy, or mobile network, and for an event delivered late it reflects the network at delivery time. Events received before October 15, 2026 also carry the IP address of the connection, and events received before October 24, 2026 may carry city-level fields; an erasure request covers them.
- PostHog's client library adds its own name and version to each event.

### Feedback reports you choose to send

A feedback report (`/feedback` or `/bug`) is separate from telemetry, and the "Never sent" list below covers telemetry only. OmO sends a report only when you choose **Send report**, to our own service at `api.omo.dev`; **See exactly what is sent** shows the full report first. Besides what you wrote, a report contains: your hostname; the session id, model and working directory; app and system details (OmO, engine and runtime versions, operating system and version, architecture, locale, time zone, and the time of the report); the last 50 messages of the conversation, including model replies; your settings; and the last 15 minutes of engine log fields. A report sent from OmO Desktop can also include the Desktop app's own logs and crash text, and, when you are signed in, your display name, plan, device name and account, user and device ids. Passwords, keys and tokens are removed before sending. If you are signed in, the report is linked to your account, including its email address. If telemetry is on when the report is prepared, it also carries your install hash and session hash so we can match it to the related telemetry. Only the OmO team can read reports, and they are kept for 90 days.

### Never sent

- Prompts, model replies, or any fragment of either
- Code, diffs, file names, file or folder paths, repository, branch, or project names
- Commands you ran, logs, error messages, or stack traces
- Account names, emails, API keys, tokens, or environment variable values, other than the login shell program name, the terminal application name, and the CI flag listed above
- Screenshots, window titles, or typed text from computer use
- The names of your own skills, providers, models, or gateways
- Your hostname, IP address, or any hardware serial

For OmO Native events the field list is enforced in code: a field that is not on it is dropped before sending, and a test fails if the code and the published list disagree. The once-a-day activity events send the fields listed under "About your computer", plus the product and plugin name, which part of the product sent it, the reason it was sent, and the UTC day.

## 3. Why we collect it, and on what legal basis

We use telemetry for four purposes and nothing else:

1. To count active installations (daily, weekly, monthly) and see adoption by operating system and version.
2. To see which features, skills, categories, and built-in models are used, so we know what to keep, fix, or remove.
3. To find crashes and failures by version.
4. To measure cost and performance (tokens, cost, timing, parallelism) and improve defaults.

Legal basis:

- **EU/EEA (GDPR):** our legitimate interest in maintaining and improving free software we publish, Article 6(1)(f). The interest is the four purposes above. We rely on it because the data is pseudonymous and minimal, is never used to profile anyone or to take a decision about anyone, is not combined with other data, and you can object at any time by turning telemetry off (section 4).
- **Republic of Korea (PIPA):** Article 15(1)(6), processing necessary to attain our legitimate interest where that interest clearly overrides your rights, within a reasonable scope.

We do not sell the data, use it for advertising, build person profiles, or make automated decisions about anyone.

## 4. Telemetry is optional: how to turn it off (your right to object)

You are not required to provide any of this data, by law or by contract. Turning telemetry off changes nothing about how OmO works. Turning it off is how you object to this processing (GDPR Article 21) and refuse the overseas transfer in section 5 (PIPA Article 28-8); you do not need to give a reason.

Any one of the environment variables below turns everything off in every product, including crash reports. The other switches apply to the product named:

- **OmO Desktop:** choose **Turn telemetry off** when the telemetry notice first appears. Desktop sends nothing before you have answered that notice.
- **OmO Native (CLI and Desktop runtime), configuration file** `~/.omo/omo.jsonc`:

  ```jsonc
  {
    "telemetry": { "enabled": false }
  }
  ```

- **OpenCode plugin, configuration file** `~/.omo/omo.jsonc`:

  ```jsonc
  {
    "[opencode]": { "telemetry": false }
  }
  ```

- **Environment variable**, any one of:

  ```bash
  export DO_NOT_TRACK=1
  export OMO_DISABLE_TELEMETRY=1
  export OMO_DISABLE_POSTHOG=1
  export OMO_SEND_ANONYMOUS_TELEMETRY=0
  ```

- **Codex adapter only:** `OMO_CODEX_DISABLE_POSTHOG=1` or `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0`.

OmO Native turns telemetry off automatically in CI and test runs; the OpenCode plugin and the Codex adapter do not, and mark such events with `ci: true`. When telemetry is off, no telemetry request is made and events already queued are dropped. Opting out applies from that moment; to delete what was sent earlier, see section 8.

## 5. Who receives the data: our processor, and the transfer abroad

We use one processor, and telemetry has no other destination.

| | |
|---|---|
| Recipient | PostHog, Inc. (United States). Privacy contact: privacy@posthog.com |
| Role | Processor (PIPA: 수탁자). PostHog stores the events and runs our queries on our instructions under its Data Processing Agreement, and does not use the events for its own purposes. |
| What is transferred | Every field listed in section 2, plus the IP address of the connection as PostHog sees it on receipt, which PostHog uses to derive the country and then discards. |
| Country | United States (PostHog US Cloud, `us.i.posthog.com`). |
| When and how | At the moment each event occurs, while OmO is running, over HTTPS (TLS). An event that could not be delivered is retried by a later OmO process for up to 14 days, then deleted unsent. |
| Purpose at the recipient | Storing the events and serving our analytics queries. |
| Retention at the recipient | See section 6. |
| How to refuse | Turn telemetry off (section 4). This stops the transfer completely and has no effect on OmO. |

**EU/EEA, UK, and Swiss users:** PostHog, Inc. is certified under the EU-U.S. Data Privacy Framework, its UK Extension, and the Swiss-U.S. DPF, so the transfer is covered by the European Commission's adequacy decision for DPF participants. PostHog's Data Processing Agreement also contains the EU Standard Contractual Clauses as a fallback. The DPA text is at https://posthog.com/dpa.

**Korean users:** the table above is the overseas-transfer notice PIPA requires before your data leaves Korea. Turning telemetry off refuses the transfer.

Nobody else receives raw events. We publish only aggregates, such as how many installations ran a given version.

## 6. Retention and deletion

- **Events in PostHog.** We have not set a retention period yet, and events are not yet deleted automatically by age. When we set one, this section will say how long events are kept and the deletion will run on that schedule.
- **Deletion method.** Today, events are deleted from PostHog's event store by install hash, on request (section 8); PostHog then removes them from its storage.
- **On your computer.** The install id file, your configuration, and daily-deduplication state stay until you delete them. Session-summary and pending-event files under OmO's state directory are deleted once sent, or after 14 days at the latest. OmO keeps no local history of what it sent.

## 7. Files OmO stores on your computer for telemetry

- `~/.omo/agent/omo-senpi/omo-native/install-id`: the random install id, created with owner-only permissions. Deleting it gives the installation a fresh id on the next run. A session started before the deletion and resumed after it keeps its session hash, which still links the old and new install hashes; to break that link too, also delete `<agent home>/omo-senpi/omo-native/session-id-salt` (agent home is `~/.omo/agent` by default).
- `<state>/session-summary/`: the open session summary of each session and events waiting for delivery. They hold numbers, masked model names, hashed session ids, and the path of the project each window was recorded in; the path is read back only to re-check that project's telemetry setting and is never sent.
- Codex adapter: `$XDG_DATA_HOME/omo-codex/posthog-activity.json` (default `~/.local/share/omo-codex/posthog-activity.json`), holding the last UTC day a daily event was sent.
- OpenCode plugin: local configuration and daily-deduplication state.
- Each product's once-a-day activity event uses its own random `install-id` file, created only when that event is about to be sent, and only its hash is sent: OmO Native `<agent home>/omo-senpi/posthog/install-id` (agent home is `~/.omo/agent` by default), the OpenCode plugin `$XDG_DATA_HOME/oh-my-opencode/install-id`, and the Codex adapter `$XDG_DATA_HOME/omo-codex/install-id` (`$XDG_DATA_HOME` defaults to `~/.local/share`).

Turning telemetry off (section 4) stops OmO from creating new telemetry files and from sending anything.

## 8. Your rights

Wherever you live, you can ask us to tell you whether we hold events for your installation and to send them to you (access); to correct or delete them (rectification, erasure); to stop processing them (restriction, suspension of processing); or to stop entirely (objection; section 4 does this immediately and needs no request). Under PIPA you may exercise these rights through a legal representative, and a parent or guardian may exercise them for a child under 14. OmO is not directed at children.

For telemetry events we hold no name, email, or account, so we cannot find your events from who you are (GDPR Article 11). To act on a request we need your install ids: the contents of `~/.omo/agent/omo-senpi/omo-native/install-id` and of every other `install-id` file listed in section 7 that exists on your computer. We hash it and act on the matching rows. Send it only through the private form or by email (section 1), never in a public issue. For events that older versions sent under a hostname hash, we can act where our records pair that hash with your install id and no other; a hostname hash shared by several installations cannot be attributed to you and cannot be deleted on request.

Feedback reports are handled separately: to have one deleted, send us its report id, which OmO shows when the report is sent ("Your report was sent (<id>)"), through the private form or by email. If you sent it while signed in, we can also find it from your account.

We answer within 10 days, and in any case within the period the law allows. There is no fee, and exercising a right has no effect on your use of OmO.

You may also complain to a supervisory authority. In Korea: the Personal Information Protection Commission (https://www.privacy.go.kr), the Personal Information Infringement Report Center (https://privacy.kisa.or.kr), or the Personal Information Dispute Mediation Committee (https://www.kopico.go.kr). In the EU/EEA: the data protection authority of the country where you live (https://www.edpb.europa.eu/about-edpb/about-edpb/members_en). We would appreciate the chance to resolve the matter first by email.

## 9. Security

Events travel over TLS. The OmO Native client enforces a field allowlist and rejects any string on a key ending in `_text`, `_path`, or `_prompt`; CI fails if the code and the published schema diverge. Person profiles are disabled on every event. PostHog is configured to discard the IP address and drop city-level location fields. The install id file is created with owner-only permissions. Access to the PostHog project is limited to the project's maintainers. No transmission or storage is perfectly secure.

## 10. Changes

We update this document before telemetry sends a new kind of data, is used for a new purpose, or goes to a new recipient, and we change the date at the top.

## 11. Related documents

- [Telemetry guide](../guide/telemetry.md)
- [Telemetry reference](../reference/senpi-telemetry.md) (generated, test-pinned schema)
- [Codex telemetry reference](../reference/codex-telemetry.md)
- [Terms of Service](./terms-of-service.md)
