import { createExtensionRuntime, type ResourceLoader } from "@code-yeongyu/senpi"

import { createMinimalSenpiResourceLoader } from "../../senpi/minimal-resource-loader"

// CHILD EXTENSION SUPPRESSION.
//
// The child MUST NOT re-load the parent agentDir's extensions (that would re-run omo-senpi
// itself inside the child, duplicating tools / MCP / component state). DefaultResourceLoader
// cannot deliver zero side effects: loadFinalExtensionSet() loads and EXECUTES path + builtin
// extension factories BEFORE `extensionsOverride` is applied (senpi core/resource-loader.ts:523),
// so an override only empties an already-executed result - the factories still RAN.
//
// Therefore the child uses a minimal senpi-task-owned ResourceLoader that returns an EMPTY
// extensions result and never touches extension discovery.
//
// v1 tradeoff: children run WITHOUT senpi builtin extensions (no compaction / goal / todo tools
// inside children); the core read/bash/edit tools plus the injected customTools remain. Skills
// and context per spec are still delivered through prompt injection.
export function createChildResourceLoader(): ResourceLoader {
  return createMinimalSenpiResourceLoader({ runtime: createExtensionRuntime() })
}
