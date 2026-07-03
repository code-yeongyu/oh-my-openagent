import type { ExtensionContext } from "../../types.ts";
import type { Reply, ReplyInput, Request } from "./types.ts";

export async function showPermissionPrompt(ctx: ExtensionContext, request: Request): Promise<ReplyInput> {
	const title = `Permission required: ${request.permission}`;
	const message = formatRequestForDisplay(request);

	const displayTitle = `${title}\n\n${message}`;

	const options = ["Allow once", "Allow always", "Deny", "Deny with feedback"];

	const choice = await ctx.ui.select(displayTitle, options);

	if (choice === "Deny with feedback") {
		const feedback = await ctx.ui.input("Feedback", "Why are you denying this permission? (optional)");
		return {
			requestID: request.id,
			reply: "reject",
			message: feedback || undefined,
		};
	}

	const replyMap: Record<string, Reply> = {
		"Allow once": "once",
		"Allow always": "always",
		Deny: "reject",
	};

	return {
		requestID: request.id,
		reply: choice ? replyMap[choice] : "reject",
	};
}

function formatRequestForDisplay(request: Request): string {
	const parts: string[] = [];
	const meta = request.metadata || {};

	switch (request.permission) {
		case "edit":
			parts.push(`File: ${meta.filepath || "Unknown"}`);
			break;
		case "read":
			parts.push(`Path: ${meta.filePath || "Unknown"}`);
			break;
		case "glob":
		case "grep":
			parts.push(`Pattern: ${meta.pattern || "Unknown"}`);
			break;
		case "list":
			parts.push(`Path: ${meta.path || "Unknown"}`);
			break;
		case "bash":
			if (meta.description) parts.push(`Description: ${meta.description}`);
			parts.push(`Command: $ ${meta.command || "Unknown"}`);
			break;
		case "websearch":
		case "codesearch":
			parts.push(`Query: ${meta.query || "Unknown"}`);
			break;
		case "external_directory": {
			const parent = typeof meta.parentDir === "string" ? meta.parentDir : undefined;
			const filepath = typeof meta.filepath === "string" ? meta.filepath : undefined;
			const pattern = request.patterns?.[0];
			const derived =
				typeof pattern === "string" ? (pattern.includes("*") ? pattern.split("*")[0] : pattern) : undefined;
			const dir = parent ?? filepath ?? derived ?? "Unknown";
			parts.push(`Directory: ${dir}`);
			break;
		}
		default:
			parts.push(`Tool: ${request.permission}`);
			break;
	}

	if (request.patterns && request.patterns.length > 0) {
		parts.push(`\nPatterns:\n${request.patterns.map((p) => `  - ${p}`).join("\n")}`);
	}

	return parts.join("\n");
}
