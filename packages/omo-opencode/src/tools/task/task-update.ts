import type { PluginInput } from "@opencode-ai/plugin";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { join } from "path";
import type { OhMyOpenCodeConfig } from "../../config/schema";
import type { TaskObject, TaskUpdateInput } from "./types";
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

function applyTaskUpdate(taskPath: string, input: TaskUpdateInput): TaskObject | null {
  const task = readJsonSafe(taskPath, TaskObjectSchema);

  if (!task) {
    return null;
  }

  if (input.subject !== undefined) {
    task.subject = input.subject;
  }
  if (input.description !== undefined) {
    task.description = input.description;
  }
  if (input.status !== undefined) {
    task.status = input.status;
  }
  if (input.activeForm !== undefined) {
    task.activeForm = input.activeForm;
  }
  if (input.owner !== undefined) {
    task.owner = input.owner;
  }

  if (input.addBlocks) {
    task.blocks = [...new Set([...task.blocks, ...input.addBlocks])];
  }

  if (input.addBlockedBy) {
    task.blockedBy = [...new Set([...task.blockedBy, ...input.addBlockedBy])];
  }

  if (input.metadata !== undefined) {
    task.metadata = { ...task.metadata, ...input.metadata };
    Object.keys(task.metadata).forEach((key) => {
      if (task.metadata?.[key] === null) {
        delete task.metadata[key];
      }
    });
  }

  const updatedTask = TaskObjectSchema.parse(task);
  writeJsonAtomic(taskPath, updatedTask);

  return updatedTask;
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
    const lock = await acquireLock(taskDir);

    if (!lock.acquired) {
      return JSON.stringify({ error: "task_lock_unavailable", retryable: true });
    }

    let updatedTask: TaskObject | null = null;
    try {
      updatedTask = applyTaskUpdate(join(taskDir, `${taskId}.json`), validatedArgs);
    } finally {
      lock.release();
    }

    if (!updatedTask) {
      return JSON.stringify({ error: "task_not_found" });
    }

    // Todo sync talks to the OpenCode session API and needs no mutual exclusion, so it runs
    // outside the critical section to keep the hold window at one read-modify-write.
    await syncTaskTodoUpdate(ctx, updatedTask, context.sessionID);

    return JSON.stringify({ task: updatedTask });
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
