import type { PluginInput } from "@opencode-ai/plugin";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { join } from "path";
import type { OhMyOpenCodeConfig } from "../../config/schema";
import type { TaskObject } from "./types";
import { TaskObjectSchema, TaskCreateInputSchema } from "./types";
import {
  getTaskDir,
  writeJsonAtomic,
  acquireLock,
  generateTaskId,
  listTaskFiles,
  readJsonSafe,
} from "../../features/claude-tasks/storage";
import { syncTaskTodoUpdate } from "./todo-sync";

export function createTaskCreateTool(
  config: Partial<OhMyOpenCodeConfig>,
  ctx?: PluginInput,
): ToolDefinition {
   return tool({
     description: `Create a new task with auto-generated ID and threadID recording.

Auto-generates T-{uuid} ID, records threadID from context, sets status to "pending".
Returns minimal response with task ID and subject.

**IMPORTANT - Dependency Planning for Parallel Execution:**
Use \`blockedBy\` to specify task IDs that must complete before this task can start.
Calculate dependencies carefully to maximize parallel execution:
- Tasks with no dependencies can run simultaneously
- Only block a task if it truly depends on another's output
- Minimize dependency chains to reduce sequential bottlenecks`,
     args: {
      subject: tool.schema.string().describe("Task subject (required)"),
      description: tool.schema.string().optional().describe("Task description"),
      activeForm: tool.schema
        .string()
        .optional()
        .describe("Active form (present continuous)"),
      metadata: tool.schema
        .record(tool.schema.string(), tool.schema.unknown())
        .optional()
        .describe("Task metadata"),
      blockedBy: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Task IDs blocking this task"),
      blocks: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Task IDs this task blocks"),
      repoURL: tool.schema.string().optional().describe("Repository URL"),
      parentID: tool.schema.string().optional().describe("Parent task ID"),
    },
    execute: async (args, context) => {
      return handleCreate(args, config, ctx, context);
    },
  });
}

async function handleCreate(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>,
  ctx: PluginInput | undefined,
  context: { sessionID: string },
): Promise<string> {
  try {
    const validatedArgs = TaskCreateInputSchema.parse(args);
    const taskDir = getTaskDir(config);
    const lock = acquireLock(taskDir);

    if (!lock.acquired) {
      return JSON.stringify({ error: "task_lock_unavailable" });
    }

    // Near-duplicate detection (advisory warning, not blocking)
    let duplicateWarning: string | undefined;
    try {
      const existingFiles = listTaskFiles(config);
      for (const fileId of existingFiles) {
        const existingTask = readJsonSafe(join(taskDir, `${fileId}.json`), TaskObjectSchema);
        if (existingTask && existingTask.subject === validatedArgs.subject && existingTask.threadID === context.sessionID) {
          duplicateWarning = `Similar task already exists: ${existingTask.id} (status: ${existingTask.status})`;
          break;
        }
      }
    } catch {
      // Dedup check is advisory, never block creation on failure
    }

    try {
      const taskId = generateTaskId();
      const task: TaskObject = {
        id: taskId,
        subject: validatedArgs.subject,
        description: validatedArgs.description ?? "",
        status: "pending",
        blocks: validatedArgs.blocks ?? [],
        blockedBy: validatedArgs.blockedBy ?? [],
        activeForm: validatedArgs.activeForm,
        metadata: validatedArgs.metadata,
        repoURL: validatedArgs.repoURL,
        parentID: validatedArgs.parentID,
        threadID: context.sessionID,
      };

      const validatedTask = TaskObjectSchema.parse(task);
      writeJsonAtomic(join(taskDir, `${taskId}.json`), validatedTask);

      await syncTaskTodoUpdate(ctx, validatedTask, context.sessionID);

      const response: Record<string, unknown> = {
        task: {
          id: validatedTask.id,
          subject: validatedTask.subject,
        },
      };
      if (duplicateWarning) {
        response.warning = duplicateWarning;
      }
      return JSON.stringify(response);
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
