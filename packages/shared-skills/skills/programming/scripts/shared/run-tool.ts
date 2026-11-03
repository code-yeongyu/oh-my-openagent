/** Shared by the Python, Rust, and Go scaffolders: run uv/cargo/go and classify the outcome. */

import { spawnSync } from "node:child_process";

export type ToolOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly status: number | null; readonly stderr: string };

export function runTool(command: string, args: readonly string[], cwd?: string): ToolOutcome {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error !== undefined) return { kind: "unavailable", reason: result.error.message };
  if (result.status === 0) return { kind: "ok" };
  return { kind: "failed", status: result.status, stderr: result.stderr };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
