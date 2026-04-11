import { resolveInheritedBeadsRuntime } from "../../features/background-agent/resolve-inherited-beads-runtime";
import { storeToolMetadata } from "../../features/tool-metadata-store";
import { getSessionTools } from "../../shared/session-tools-store";
import { formatDetailedError } from "./error-formatting";
import type { ExecutorContext, ParentContext } from "./executor-types";
import { resolveCallID } from "./resolve-call-id";
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types";

export async function executeBackgroundContinuation(
	args: DelegateTaskArgs,
	ctx: ToolContextWithMetadata,
	executorCtx: ExecutorContext,
	parentContext: ParentContext,
): Promise<string> {
	const { manager } = executorCtx;

	try {
		const existingTask = manager.findBySession?.(args.session_id!);
		const beadsRuntime = resolveInheritedBeadsRuntime({
			manager,
			directory: executorCtx.directory,
			parentSessionID: parentContext.sessionID,
			currentBeadsRuntime: existingTask?.beadsRuntime,
		});
		const task = await manager.resume({
			sessionId: args.session_id!,
			prompt: args.prompt,
			parentSessionID: parentContext.sessionID,
			parentMessageID: parentContext.messageID,
			parentModel: parentContext.model,
			parentAgent: parentContext.agent,
			parentTools: getSessionTools(parentContext.sessionID),
			beadsRuntime,
		});

		const bgContMeta = {
			title: `Continue: ${task.description}`,
			metadata: {
				prompt: args.prompt,
				agent: task.agent,
				load_skills: args.load_skills,
				description: args.description,
				run_in_background: args.run_in_background,
				sessionId: task.sessionID,
				command: args.command,
				model: task.model
					? { providerID: task.model.providerID, modelID: task.model.modelID }
					: undefined,
				...(task.beadsRuntime ? { beadsRuntime: task.beadsRuntime } : {}),
			},
		};
		await ctx.metadata?.(bgContMeta);
		const callID = resolveCallID(ctx);
		if (callID) {
			storeToolMetadata(ctx.sessionID, callID, bgContMeta);
		}

		return `Background task continued.

Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Agent continues with full previous context preserved.
System notifies on completion. Use \`background_output\` with task_id="${task.id}" to check.

Do NOT call background_output now. Wait for <system-reminder> notification first.

<task_metadata>
session_id: ${task.sessionID}
${task.agent ? `subagent: ${task.agent}\n` : ""}</task_metadata>`;
	} catch (error) {
		return formatDetailedError(error, {
			operation: "Continue background task",
			args,
			sessionID: args.session_id,
		});
	}
}
