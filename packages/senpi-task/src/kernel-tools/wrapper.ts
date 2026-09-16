import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"

import {
  kernelToolErrorCode,
  kernelToolErrorMessage,
  type KernelToolDescriptor,
  type KernelToolErrorCode,
} from "./contract"
import type { KernelToolGrant } from "./resolve"

export type KernelToolResultDetails = {
  readonly kernel_tool: string
  readonly error?: { readonly code: KernelToolErrorCode; readonly message: string }
}

export type KernelToolWrapperOptions = {
  // Identity gate evaluated on EVERY invocation: a wrapper whose binding is no longer the child's
  // current one must fail closed instead of reaching a parent kernel it no longer belongs to.
  readonly isCurrent?: () => boolean
}

function envelope(details: KernelToolResultDetails, value: unknown): AgentToolResult<KernelToolResultDetails> {
  const body = details.error === undefined
    ? { kernel_tool: details.kernel_tool, value: value ?? null }
    : { kernel_tool: details.kernel_tool, error: details.error }
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    details,
    ...(details.error === undefined ? {} : { isError: true }),
  }
}

export function kernelToolErrorResult(
  name: string,
  code: KernelToolErrorCode,
  message: string,
): AgentToolResult<KernelToolResultDetails> {
  return envelope({ kernel_tool: name, error: { code, message } }, undefined)
}

function wrapper(
  descriptor: KernelToolDescriptor,
  grant: KernelToolGrant,
  options: KernelToolWrapperOptions,
): ToolDefinition {
  return {
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.description.length > 0
      ? descriptor.description
      : `Parent-defined JavaScript tool ${descriptor.name}.`,
    parameters: Type.Unsafe<Record<string, unknown>>(descriptor.input_schema),
    execute: async (toolCallId, args, signal) => {
      // Descriptor tuple + identity are validated locally first; the fenced tuple then travels with
      // every call so the parent kernel itself rejects a stale generation/revision.
      if (options.isCurrent?.() === false) {
        return kernelToolErrorResult(
          descriptor.name,
          "tools_unavailable",
          `Parent kernel tool "${descriptor.name}" is no longer bound to this child.`,
        )
      }
      try {
        const value = await grant.capability.invoke(
          {
            name: descriptor.name,
            kernel_generation: descriptor.kernel_generation,
            definition_revision: descriptor.definition_revision,
            args,
            call_id: toolCallId,
          },
          signal,
        )
        return envelope({ kernel_tool: descriptor.name }, value)
      } catch (error) {
        return kernelToolErrorResult(descriptor.name, kernelToolErrorCode(error), kernelToolErrorMessage(error))
      }
    },
  }
}

/** Child-facing wrappers for a resolved grant: one per descriptor, callable by name. */
export function createKernelToolWrappers(
  grant: KernelToolGrant,
  options: KernelToolWrapperOptions = {},
): ToolDefinition[] {
  return grant.descriptors.map((descriptor) => wrapper(descriptor, grant, options))
}

/**
 * Error stubs for a revived child whose parent kernel binding is gone. The stub NEVER invokes a
 * closure; it exists only so the child reads a typed unavailable result on its own tool channel.
 */
export function createUnavailableKernelToolStubs(names: readonly string[], message: string): ToolDefinition[] {
  return names.map((name) => ({
    name,
    label: name,
    description: `Parent-defined JavaScript tool ${name} (no longer available in this session).`,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async () => kernelToolErrorResult(name, "tools_unavailable", message),
  }))
}
