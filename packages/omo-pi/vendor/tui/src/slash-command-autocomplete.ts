import type { AutocompleteItem, SlashCommand } from "./autocomplete.ts";
import { fuzzyFilter } from "./fuzzy.ts";

type CommandItem = {
	readonly name: string;
	readonly label: string;
	readonly description?: string;
};

type RankedCommandItem = AutocompleteItem & {
	readonly index: number;
};

function compareSlashCommandSuggestion(prefix: string, left: RankedCommandItem, right: RankedCommandItem): number {
	const leftExact = left.value === prefix;
	const rightExact = right.value === prefix;
	if (leftExact !== rightExact) return leftExact ? -1 : 1;

	const leftPrefix = left.value.startsWith(prefix);
	const rightPrefix = right.value.startsWith(prefix);
	if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
	if (leftPrefix && rightPrefix && left.value.length !== right.value.length) {
		return right.value.length - left.value.length;
	}

	return left.index - right.index;
}

export function getSlashCommandSuggestions(
	commands: readonly (SlashCommand | AutocompleteItem)[],
	prefix: string,
): AutocompleteItem[] {
	const commandItems: CommandItem[] = commands.map((cmd) => {
		const name = "name" in cmd ? cmd.name : cmd.value;
		const hint = "argumentHint" in cmd && cmd.argumentHint ? cmd.argumentHint : undefined;
		const desc = cmd.description ?? "";
		const fullDesc = hint ? (desc ? `${hint} — ${desc}` : hint) : desc;
		return {
			name,
			label: name,
			description: fullDesc || undefined,
		};
	});

	return fuzzyFilter(commandItems, prefix, (item) => item.name)
		.map((item, index) => ({
			value: item.name,
			label: item.label,
			...(item.description && { description: item.description }),
			index,
		}))
		.sort((left, right) => compareSlashCommandSuggestion(prefix, left, right))
		.map(({ index: _index, ...item }) => item);
}
