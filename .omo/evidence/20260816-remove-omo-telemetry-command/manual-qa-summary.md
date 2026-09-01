# Manual QA summary

## TUI command removal

Invocation:

```text
node script/qa/web-terminal-visual-qa.mjs
  --title "OmO telemetry command removal"
  --command "env <isolated vars> ./node_modules/.bin/senpi ... -e packages/omo-senpi/plugin/extensions/omo.js"
  --input "{Escape}"
  --input "/omo-telemetry"
  --input "{Enter}"
  --key-delay-ms 5000
  --dwell-ms 3000
  --evidence-dir .omo/evidence/20260816-remove-omo-telemetry-command/tui-pass
```

Binary observation:

- The real TUI loaded the worktree's built `omo.js`.
- Entering `/omo-telemetry` did not render the former `Enabled`, `Opt-out matrix`, or
  `Last payloads` command output. It followed the ordinary prompt path and reached the
  expected no-model/API-key error in the isolated environment, proving no slash-command
  handler consumed it.
- The built bundle contains neither the `omo-telemetry` command token nor the
  `last-payloads.json` token, while retaining the disclosure-notice token.
- No `last-payloads.json` existed anywhere in the isolated TUI sandbox.

Artifacts:

- `tui-pass/terminal.png`
- `tui-pass/terminal.txt`
- `tui-pass/terminal-ansi.txt`
- `tui-pass/metadata.json`

The earlier `tui/` directory is a rejected setup attempt: its combined input token was
typed before startup and therefore did not exercise the command. It is retained only to
make the evidence trail honest and is not cited as passing proof.

## Disclosure remains

Invocation:

```text
node script/qa/web-terminal-visual-qa.mjs
  --title "OmO telemetry disclosure remains"
  --command "env <isolated vars> POSTHOG_API_KEY=phc_test POSTHOG_HOST=http://127.0.0.1:9 ./node_modules/.bin/senpi ..."
  --dwell-ms 7000
  --evidence-dir .omo/evidence/20260816-remove-omo-telemetry-command/disclosure-tui
```

Binary observation:

- The real TUI displayed: `omo-senpi sends anonymous usage telemetry (no prompts, no paths)`.
- It displayed the public documentation URL and `opt out: DO_NOT_TRACK=1`.
- No `last-payloads.json` existed in the isolated disclosure sandbox.

Artifacts:

- `disclosure-tui/terminal.png`
- `disclosure-tui/terminal.txt`
- `disclosure-tui/terminal-ansi.txt`
- `disclosure-tui/metadata.json`

## Enabled and opt-out runtime

Invocation:

```text
npm exec --yes --package=bun@1.3.12 -- bun \
  .omo/evidence/20260816-remove-omo-telemetry-command/runtime-driver.mjs
```

Binary observation:

- Enabled isolated Senpi run: two requests reached the local capture server.
- `OMO_DISABLE_POSTHOG=1` isolated Senpi run: zero requests reached the server.
- Both real CLI runs completed through the local provider.
- Neither sandbox contained `last-payloads.json`.

Artifacts:

- `runtime-driver.mjs`
- `runtime-result.json`
- `runtime-cleanup.json`

The repository's broader `script/qa/omo-native-telemetry-qa.mjs` was also attempted. It
cleaned up correctly but rejected the run because current `origin/dev` emitted two rather
than its expected three real-prompt events. That unrelated prompt-ordinal assertion was
not weakened or retried; the narrower driver above directly proves this change's enabled,
opt-out, and no-history criteria.

## Why this is enough

The TUI artifacts exercise the real built extension and show both user-facing outcomes:
the command is no longer handled and the disclosure remains visible. The runtime driver
uses the real Senpi CLI and built extension against a local capture server, proving live
telemetry still sends when enabled, sends nothing when opted out, and creates no local
payload-history artifact.

## What was omitted

No real provider credentials, PostHog credentials, prompts, auth headers, environment
dumps, or user data were recorded. All payloads and model responses were synthetic.
