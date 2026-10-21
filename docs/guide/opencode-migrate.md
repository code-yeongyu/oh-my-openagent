# Migrating a single OpenCode setup to `omo setup`

Use this page when you want to take the assets (`~/.config/opencode/opencode.json[c]` +
`~/.opencode/`) of a single OpenCode install and feed them through `omo setup` once, instead of
the multi-harness `omo setup` walkthrough in
[Migrating from OpenCode](./migrating-from-opencode.md). It covers what the per-server consent UX
asks, the three opt-out scopes, and how to keep `omo setup --yes` working for unattended
provisioning.

The standalone CLI never writes to OpenCode's files. `--yes`, `--ask-each`, and `--dry-run`
preserve every behavior from before PR-D.

## What the per-server consent UX asks

The interactive flow of `omo setup` no longer prompts once for the entire plan. Every MCP server
and every custom OpenCode provider the opencode config declares gets its own prompt of the form:

```
<name> (<kind>, <url>[, <command>]) [headers: <canonical file refs> | key: <source>] Import? [Y/n]
```

`<kind>` is `mcp` for an MCP server entry from the opencode `mcp` block, or `provider` for a
`provider.<id>` block (including catalog providers the engine serves). The provenance summary is
deliberately short — credentials never ride in the line, only the path placeholder
(`{file:/abs/path}`) or a key source label.

`Import?` defaults to **yes**. Empty input, `y`, or `yes` accepts; `n` or `no` declines. A
declined server is left out of the engine's `<agentDir>/mcp.json` or `<agentDir>/models.json`
respectively; nothing else changes for that file. Credentials and model choices are not servers
and were never opted into per-server consent; they continue to apply when their stage prompts
succeed.

A `--dry-run` invocation lists every per-server row above and writes nothing.

## Three opt-out scopes: `setup.opt_out`

When a server you'd rather never see comes up repeatedly, drop it from the prompt by editing
`~/.omo/omo.json[c]` under `setup.opt_out`. Three scopes compose — any one match skips the server:

```jsonc
{
  "setup": {
    "opt_out": {
      // exact match on the MCP server name or the provider id
      "flagged-shelly": true,

      // any server of this kind (mcp | provider)
      "kind": { "provider": true },

      // any server whose headers or key reference a file path matching the glob
      "source": { "/etc/lobster/secrets/*": true }
    }
  }
}
```

Scopes compose: a server skipped by `kind: { provider: true }` is recorded as
`accept=false` with `skippedReason=opt-out:kind`. The dry-run output preserves the rows so you
can audit what was skipped and why.

The opt-out config is read from the user-level `~/.omo/omo.jsonc`; project-level overrides do
not extend it. A malformed `setup.opt_out` block is treated as empty, so the prompt layer falls
back to asking per server.

## Unattended provisioning with `--yes`

Scripted callers see no behavior change. Pass `--yes` to keep the legacy single-batch consent:

```sh
omo setup --yes
```

`--yes` ignores the opt-out config's per-server short-circuit — every server ships. Use opt-out
only at the interactive layer; for automation, mix `--yes` with the provider ids and MCP server
names you want carried and pre-filter through a separate audit (e.g. `[native]`
`omo.json` rules) rather than relying on a user opt-in.

`--ask-each` keeps the legacy per-stage `Y/n` (credentials, assets, providers, model choices) for
environments where the per-server UX is too dense.

## When `auth.json` keeps the credential you wanted despite a `provider.<id>` block

`omo setup` does not over-write a key the credential stage already wrote. If you opt out the
provider but leave the credential stage running, the credential-stage key (whatever
`~/.local/share/opencode/auth.json` mapped onto) wins; the provider's `apiKey` is dropped. This
is the same pre-PR-D behavior, surfaced here so a `--yes` user is not surprised.
