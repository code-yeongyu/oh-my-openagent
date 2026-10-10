import type { ToolDefinition } from "@code-yeongyu/senpi"
import {
  childStructuralToolNames,
  createKernelToolBindings,
  mergeChildCustomTools,
  type KernelToolBindingRegistry,
} from "@oh-my-opencode/senpi-task"

import { TASK_CHILD_UI_ONLY_TOOL_NAMES } from "./engine-runners"

export type EngineKernelTools = {
  /**
   * ONE runtime-only parent kernel-tool map per engine, shared by the in-process runner (grant and
   * same-host revival), the lifecycle (release on destruction/expunge/shutdown) and the manager's
   * pool admission (fresh resolution per new worker). Nothing in it is ever persisted.
   */
  readonly bindings: KernelToolBindingRegistry
  /**
   * The tool names a child of this parent already carries. The task tool resolves a `tools` request
   * against them BEFORE any child session or task record exists, so a colliding name and a child
   * whose own policy would turn a parent closure into a write bypass are refused at the tool layer.
   */
  readonly childToolNames: () => readonly string[]
}

export function createEngineKernelTools(sharedParentTools: () => readonly ToolDefinition[]): EngineKernelTools {
  return {
    bindings: createKernelToolBindings(),
    childToolNames: () => childStructuralToolNames(
      mergeChildCustomTools(sharedParentTools(), undefined, { uiOnlyToolNames: TASK_CHILD_UI_ONLY_TOOL_NAMES }).map((tool) => tool.name),
    ),
  }
}
