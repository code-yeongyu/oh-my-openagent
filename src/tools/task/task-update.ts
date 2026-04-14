import type { PluginInput } from "@opencode-ai/plugin";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { join } from "path";
import type { OhMyOpenCodeConfig } from "../../config/schema";
import { TaskObjectSchema, TaskUpdateInputSchema } from "./types";
import {
  getTaskDir,
  readJsonSafe,
  writeJsonAtomic,
  acquireLock,
} from "../../features/claude-tasks/storage";
import { syncTaskTodoUpdate } from "./todo-sync";

const TASK_ID_PATTERN = /^T-[A-Za-z0-9-]+$/;

function parseTaskId(id: string): string | null {
  if (!TASK_ID_PATTERN.test(id)) return null;
  return id;
}

export function createTaskUpdateTool(
  config: Partial<OhMyOpenCodeConfig>,
  ctx?: PluginInput,
): ToolDefinition {
   return tool({
     description: `Update an existing task with new values.

Supports updating: subject, description, status, activeForm, owner, metadata.
For blocks/blockedBy: use addBlocks/addBlockedBy to append (additive, not replacement).
For metadata: merge with existing, set key to null to delete.
Syncs to OpenCode Todo API after update.

**IMPORTANT - Dependency Management:**
Use \`addBlockedBy\` to declare dependencies on other tasks.
Properly managed dependencies enable maximum parallel execution.`,
     args: {
      id: tool.schema.string().describe("Task ID (required)"),
      subject: tool.schema.string().optional().describe("Task subject"),
      description: tool.schema.string().optional().describe("Task description"),
      status: tool.schema
        .enum(["pending", "in_progress", "completed", "deleted"])
        .optional()
        .describe("Task status"),
      activeForm: tool.schema
        .string()
        .optional()
        .describe("Active form (present continuous)"),
      owner: tool.schema
        .string()
        .optional()
        .describe("Task owner (agent name)"),
      addBlocks: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Task IDs to add to blocks (additive, not replacement)"),
      addBlockedBy: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Task IDs to add to blockedBy (additive, not replacement)"),
      metadata: tool.schema
        .record(tool.schema.string(), tool.schema.unknown())
        .optional()
        .describe("Task metadata to merge (set key to null to delete)"),
    },
    execute: async (args, context) => {
      return handleUpdate(args, config, ctx, context);
    },
  });
}

async function handleUpdate(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>,
  ctx: PluginInput | undefined,
  context: { sessionID: string },
): Promise<string> {
  try {
    const validatedArgs = TaskUpdateInputSchema.parse(args);
    const taskId = parseTaskId(validatedArgs.id);
    if (!taskId) {
      return JSON.stringify({ error: "invalid_task_id" });
    }

    const taskDir = getTaskDir(config);
    const lock = acquireLock(taskDir);

    if (!lock.acquired) {
      return JSON.stringify({ error: "task_lock_unavailable" });
    }

    try {
      const taskPath = join(taskDir, `${taskId}.json`);
      const task = readJsonSafe(taskPath, TaskObjectSchema);

      if (!task) {
        return JSON.stringify({ error: "task_not_found" });
      }

      if (validatedArgs.subject !== undefined) {
        task.subject = validatedArgs.subject;
      }
      if (validatedArgs.description !== undefined) {
        task.description = validatedArgs.description;
      }

      // Merge addBlocks and addBlockedBy before the completion guard
      // so the guard checks the final set of blockers (prevents bypass via same-request addBlockedBy)
      const addBlocks = args.addBlocks as string[] | undefined;
      if (addBlocks) {
        task.blocks = [...new Set([...task.blocks, ...addBlocks])];
      }

      const addBlockedBy = args.addBlockedBy as string[] | undefined;
      if (addBlockedBy) {
        task.blockedBy = [...new Set([...task.blockedBy, ...addBlockedBy])];
      }

      // BlockedBy completion guard
      if (validatedArgs.status === "completed" && task.blockedBy && task.blockedBy.length > 0) {
        const taskDir = getTaskDir(config);
        const unresolvedBlockers: string[] = [];
        for (const blockerId of task.blockedBy) {
          const normalizedBlockerId = parseTaskId(blockerId);
          if (!normalizedBlockerId) {
            unresolvedBlockers.push(blockerId);
            continue;
          }
          const blockerPath = join(taskDir, `${normalizedBlockerId}.json`);
          const blockerTask = readJsonSafe(blockerPath, TaskObjectSchema);
          if (!blockerTask || (blockerTask.status !== "completed" && blockerTask.status !== "deleted")) {
            unresolvedBlockers.push(blockerId);
          }
        }
        if (unresolvedBlockers.length > 0) {
          return JSON.stringify({
            error: "blocked_by_unresolved",
            unresolved: unresolvedBlockers,
            message: `Cannot mark task as completed. The following blocking tasks are not resolved: ${unresolvedBlockers.join(", ")}`,
          });
        }
      }

      if (validatedArgs.status !== undefined) {
        task.status = validatedArgs.status;
      }
      if (validatedArgs.activeForm !== undefined) {
        task.activeForm = validatedArgs.activeForm;
      }
      if (validatedArgs.owner !== undefined) {
        task.owner = validatedArgs.owner;
      }

      if (validatedArgs.metadata !== undefined) {
        task.metadata = { ...task.metadata, ...validatedArgs.metadata };
        Object.keys(task.metadata).forEach((key) => {
          if (task.metadata?.[key] === null) {
            delete task.metadata[key];
          }
        });
      }

      const validatedTask = TaskObjectSchema.parse(task);
      writeJsonAtomic(taskPath, validatedTask);

      await syncTaskTodoUpdate(ctx, validatedTask, context.sessionID);

      return JSON.stringify({ task: validatedTask });
    } finally {
      lock.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Required")) {
      return JSON.stringify({
        error: "validation_error",
        message: error.message,
      });
    }
    return JSON.stringify({ error: "internal_error" });
  }
}
