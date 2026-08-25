## Problem

Senpi process children rebuild their runtime from command-line launch inputs. The parent can also have effective resources that exist only in loaded settings or in-memory runtime state. Today the task engine explicitly forwards extension entries and the selected model, and it now verifies exact child-visible model admission, but it does not define parity for the rest of the parent's effective resource graph.

This ambiguity makes it easy for a process child to differ from the parent in ways that are discovered only after launch.

## Scope

Define a typed, security-reviewed process-child resource contract covering:

- provider and model registrations;
- tools and tool permissions;
- agents and categories;
- MCP servers;
- skills and prompt templates;
- context files;
- explicit extension entries;
- runtime-installed or dynamically registered resources;
- create, respawn, and resumed-session parity.

The contract must distinguish:

1. resources that are safe and required to reproduce in a child;
2. resources that must remain parent-only;
3. credential references that may be resolved through the child agent directory without copying secrets;
4. transient in-memory resources that cannot be reproduced and must fail admission explicitly.

## Security and persistence constraints

- Never persist credentials, tokens, auth headers, or secret-bearing environment dumps.
- Never pass secrets on argv.
- Preserve member-process least privilege and generic-descendant identity stripping.
- Do not silently weaken tools or resource sets during respawn.
- Make every unsupported resource produce a typed admission or resume failure.

## Acceptance criteria

- A documented resource-parity matrix exists for every process-child resource family.
- One canonical typed launch profile drives create and respawn.
- Parent-only and child-safe resources are enforced, not inferred by name.
- Credential-free preflight proves the effective child profile before durable launch.
- Real pinned-Senpi tests cover settings-loaded, extension-loaded, and runtime-only resources.
- Crash/restart and resume tests prove the same profile is reconstructed without persisting secrets.

## Relationship to the Team Mode repair

The Team Mode replacement for #6801 fixes the immediate member boundary, extension assembly, exact model visibility, and RPC terminal outcome defects. It deliberately does not invent this broader abstraction inside an incident repair.
