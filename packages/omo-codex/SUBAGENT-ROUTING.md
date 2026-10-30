# LazyCodex subagent routing

LazyCodex selects roles by the actual native spawn schema, not by a Codex version or V1/V2 namespace. If `agent_type` is exposed, every spawn must name an installed LazyCodex role. For ordinary V2 tasks pass `fork_turns: "none"`; for V1 pass `fork_context: false`. A deliberate full-history fork still needs an explicit role.

The explicit role registry is the 12 bundled TOMLs in `plugin/components/ultrawork/agents/`. Implementation difficulty maps to `lazycodex-worker-low`, `lazycodex-worker-medium`, or `lazycodex-worker-high`; planning, exploration, research, and review use their named roles. Role descriptions in `message` are task instructions, not role selectors.

## Managed default and ownership

Both the installer and marketplace bootstrap derive `CODEX_HOME/agents/default.toml` from the installed medium worker, change its internal `name` to `default`, and register `[agents.default] config_file = "./agents/default.toml"`. This configured role wins over Codex's inherit-parent built-in default for unnamed non-full-history spawns. It does not select other specialized profiles.

Installation is on by default. Opt out using the existing unified configuration in `~/.omo/omo.jsonc` (or its usual project/profile layers):

```json
{
  "[codex]": {
    "agents": {
      "default": { "disable": true }
    }
  }
}
```

Re-run installation after changing this setting; bootstrap also applies it when setup runs on upgrade. An unchanged owned default upgrades idempotently. Its SHA-256 receipt is stored beside it in `.lazycodex-default.sha256`. A pre-existing user default, a changed formerly managed default, a symlink/directory, or a foreign registration is preserved and reported as an installer error or bootstrap degraded entry. Move the conflicting default aside yourself to install the managed fallback, or opt out. Opt-out removes only an unchanged owned file and its own registration, never a customized file or foreign registration. Explicit `agent_type: "default"` is intentionally not admitted: ownership can be opted out, so select `lazycodex-worker-medium` instead.

## Guarded spawn matrix

The PreToolUse guard validates native spawn requests before checking for a ULW plan, fan-out limits, or review artifacts. Unknown, generic, empty, malformed, and omitted roles fail with an explicit denial; valid role requests then pass through the existing budget/artifact checks. Senpi toolkit behavior is unchanged.

| Role selection | Non-full-history | Full-history |
| --- | --- | --- |
| Named bundled role | Admitted to configured role, subject to existing guards | Guard admits the role; Codex either applies it or rejects an incompatible fork |
| Named unknown/generic role | Denied | Denied |
| Unnamed | Denied by guard; managed default protects unguarded non-forks | Denied by guard; upstream gap if guard is not invoked |

Codex's hook payload does not include the exposed tool schema. The guard cannot distinguish omitted `agent_type` from a legacy schema that lacks the field, so it fails closed in both cases. Guidance retains the legacy fallback: omit an unsupported parameter, carry complete role instructions in `message`, and explicitly disable history. This is not specialized TOML selection, and a guarded runtime will reject it. Report the compatibility failure rather than retrying a generic spawn.

Live isolated QA on Codex 0.154.0 found that V1 rejects an explicit role on a full-history fork with `Full-history forked agents inherit the parent agent type`. That is a loud failure, not generic fallback. Use a non-fork spawn instead; do not remove the role to get past the error.

## Remaining upstream gap

Codex skips role application for an unnamed full-history fork before configured defaults can take effect. V2 defaults to full-history when `fork_turns` is omitted. LazyCodex cannot repair that role-application path with configuration. The hook can deny a request when installed, trusted, and invoked, but cannot guarantee enforcement on surfaces that do not run it. Do not claim that every possible Codex spawn is fixed or that an unnamed full-history fork uses the managed default. Closing the underlying path requires an upstream Codex change.

## Updating

After a release containing this change, update LazyCodex through its normal installer or marketplace upgrade, allow bootstrap to finish, and restart Codex so it reloads role configuration and trusted hooks. Source merges are not releases; the distribution must sync before marketplace users receive the change.
