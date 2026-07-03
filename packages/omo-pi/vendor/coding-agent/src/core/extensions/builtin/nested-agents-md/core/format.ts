export interface FormatDirectoryContextInput {
	absolutePath: string;
	content: string;
	truncated: boolean;
}

export function formatDirectoryContext(input: FormatDirectoryContextInput): string {
	const notice = input.truncated
		? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${input.absolutePath}]`
		: "";
	return `\n\n[Directory Context: ${input.absolutePath}]\n${input.content}${notice}`;
}
