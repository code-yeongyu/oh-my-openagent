# QA evidence — remove the retired metis/momus agent-name alias

Date: 2026-09-12T04:56:00.994Z
Driver: packages/omo-senpi/scripts/qa/plan-gated-agents-e2e.mjs (real senpi binary, built plugin bundle, isolated SENPI_CODING_AGENT_DIR + HOME + XDG dirs)
Bundle: packages/omo-senpi/plugin (built from this branch with `bun run build:senpi-plugin`)

## What was tested

The four retired-name scenarios assert the REMOVED alias at every input boundary, on a live senpi process:

| scenario | proves |
|---|---|
| retired-id | `task(subagent_type: "momus")` is not routed onto plan-reviewer, starts no reviewer child, reports an unresolved target, prints no deprecation line, and carries no `legacy_subagent_type` field |
| team-retired | `team_create` with member `momus` is rejected naming the submitted id, never `"plan-reviewer" (requested as "momus")` |
| dag-retired | a workflow node with `subagent_type: "metis"` starts, stores `"agent":"metis"` verbatim in the route, and emits no deprecation warning |
| retired-config | `omo.json` `agents.momus` defines an ordinary custom agent that carries the key's model and completes, plan-reviewer is untouched, and session start emits NO alias notice |
| description | the task tool description still names the canonical plan-gated roster and no retired persona |

## What was observed

- **retired-id: PASS** — {"retired_id_not_routed_to_canonical":true,"no_reviewer_child_started":true,"spawn_reported_unresolved":true,"no_deprecation_notice":true,"no_legacy_alias_field":true,"exit_zero":true}
- **team-retired: PASS** — {"team_create_rejected_naming_retired_id":true,"rejection_never_names_canonical":true,"no_member_spawned":true,"exit_zero":true}
- **dag-retired: PASS** — {"dag_run_started":true,"no_deprecation_warning":true,"route_keeps_retired_id":true,"exit_zero":true}
- **retired-config: PASS** — {"retired_key_defines_custom_agent":true,"custom_agent_spawn_completed":true,"plan_reviewer_untouched":true,"no_startup_alias_notice":true,"exit_zero":true}
- **description: PASS** — {"description_captured":true,"plan_gated_roster_named":true,"no_retired_persona":true,"exit_zero":true}

Every scenario reported `realSenpiCredentialsUntouched: true`; the driver removes its sandbox on exit.

## Why it is enough

Each scenario drives the real binary through the surface a user touches (task tool, team_create, the workflow tool via an eval cell, and session start against an omo.json), and each asserts the ABSENCE of the removed behavior together with a positive fact (the submitted id surviving verbatim, the custom agent completing), so a scenario cannot pass by simply doing nothing.

The negative startup-notice check in `retired-config` is paired with a control run outside this driver: the same installed release binary, given an isolated HOME whose omo.jsonc still carries `agents.momus`, DOES print `omo-senpi: omo.json agents.momus is deprecated; rename the key to agents.plan-reviewer...`. The probe can therefore fail.

## What was omitted

No secrets, tokens, credentials, or host identity are recorded here; the driver's sandbox paths are temporary and removed on exit.
