export interface ToolExecuteInput {
	tool: string;
	sessionID: string;
	callID: string;
}

export interface ToolExecuteOutput {
	title: string;
	output: string;
	metadata: unknown;
}

export interface ToolExecuteBeforeOutput {
	args: unknown;
	blocked?: boolean;
	message?: string;
}

export interface ReadToolArgs {
	filePath?: string;
}

export interface WriteToolArgs {
	filePath?: string;
	content?: string;
}

export interface EditToolArgs {
	filePath?: string;
	oldString?: string;
	newString?: string;
}

export interface BashToolArgs {
	command?: string;
}

export interface ComplianceViolation {
	type: string;
	pattern: string;
	severity: "warning" | "error";
}
