import type { SearchAttempt, SearchDetails, SearchProviderEntry } from "./types.ts";

function entryLabel(entry: Pick<SearchProviderEntry, "provider" | "id"> | SearchAttempt): string {
	if ("entryId" in entry && entry.entryId) return `${entry.provider}/${entry.entryId}`;
	if ("id" in entry && entry.id) return `${entry.provider}/${entry.id}`;
	return entry.provider;
}

export function formatSearchText(details: SearchDetails): string {
	if (details.error) return details.error;
	if (details.results.length === 0) return `No web search results found for "${details.query}".`;

	const route = details.strategy
		? ` via ${details.entryId ? `${details.provider}/${details.entryId}` : details.provider} (${details.strategy})`
		: ` via ${details.provider}`;
	const lines = [`Web search results for "${details.query}"${route}:`, ""];
	if (details.attempts && details.attempts.length > 0) {
		lines.push(
			`Routing attempts: ${details.attempts
				.map(
					(attempt) =>
						`${entryLabel(attempt)} ${attempt.error ? `failed: ${attempt.error}` : `${attempt.resultsCount} result${attempt.resultsCount === 1 ? "" : "s"}`}`,
				)
				.join(" -> ")}`,
			"",
		);
	}
	for (const [index, item] of details.results.entries()) {
		lines.push(`${index + 1}. ${item.title}`);
		lines.push(`   ${item.url}`);
		if (item.snippet) lines.push(`   ${item.snippet}`);
	}
	lines.push("", "REMINDER: Include relevant sources from the URLs above in the final answer.");
	return lines.join("\n");
}
