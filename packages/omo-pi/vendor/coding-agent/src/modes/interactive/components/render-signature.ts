const SIGNATURE_STRING_MAX_LENGTH = 160;
const SIGNATURE_STRING_SAMPLE_EDGE_LENGTH = 64;
const SIGNATURE_STRING_SAMPLE_WINDOW_LENGTH = 64;
const SIGNATURE_ARRAY_ITEM_LIMIT = 40;
const SIGNATURE_OBJECT_KEY_LIMIT = 80;
const SIGNATURE_DEPTH_LIMIT = 8;

type RenderSignatureValue =
	| string
	| number
	| boolean
	| null
	| readonly RenderSignatureValue[]
	| { readonly [key: string]: RenderSignatureValue };

export function createBoundedRenderSignature(value: unknown): string {
	return JSON.stringify(summarizeSignatureValue(value));
}

function summarizeSignatureString(text: string): string {
	if (text.length <= SIGNATURE_STRING_MAX_LENGTH) {
		return text;
	}
	const sample = sampleSignatureString(text);
	return `[string length=${text.length} hash=${hashSignatureString(sample)}]`;
}

function sampleSignatureString(text: string): string {
	const first = text.slice(0, SIGNATURE_STRING_SAMPLE_EDGE_LENGTH);
	const last = text.slice(-SIGNATURE_STRING_SAMPLE_EDGE_LENGTH);
	const middleStart = Math.max(0, Math.floor((text.length - SIGNATURE_STRING_SAMPLE_WINDOW_LENGTH) / 2));
	const quarterStart = Math.max(0, Math.floor((text.length - SIGNATURE_STRING_SAMPLE_WINDOW_LENGTH) / 4));
	const threeQuarterStart = Math.max(0, Math.floor(((text.length - SIGNATURE_STRING_SAMPLE_WINDOW_LENGTH) * 3) / 4));
	return [
		first,
		text.slice(quarterStart, quarterStart + SIGNATURE_STRING_SAMPLE_WINDOW_LENGTH),
		text.slice(middleStart, middleStart + SIGNATURE_STRING_SAMPLE_WINDOW_LENGTH),
		text.slice(threeQuarterStart, threeQuarterStart + SIGNATURE_STRING_SAMPLE_WINDOW_LENGTH),
		last,
	].join("\u0000");
}

function hashSignatureString(source: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < source.length; index++) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

function hashSignatureValue(value: unknown): string {
	return hashSignatureString(JSON.stringify(summarizeSignatureValue(value)));
}

function summarizeSignatureValue(
	value: unknown,
	key = "",
	depth = 0,
	seen: WeakSet<object> = new WeakSet(),
): RenderSignatureValue {
	if (typeof value === "string") {
		return summarizeSignatureString(value);
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		return value;
	}
	if (typeof value === "undefined") {
		return "[undefined]";
	}
	if (typeof value === "bigint") {
		return `[bigint ${value.toString()}]`;
	}
	if (typeof value === "symbol") {
		return `[symbol ${value.description ?? ""}]`;
	}
	if (typeof value === "function") {
		return `[function ${value.name}]`;
	}
	if (seen.has(value)) {
		return "[circular]";
	}
	if (depth >= SIGNATURE_DEPTH_LIMIT) {
		return Array.isArray(value) ? `[array depth-limit length=${value.length}]` : "[object depth-limit]";
	}
	seen.add(value);

	const jsonValue = hasJsonSerializer(value) ? value.toJSON(key) : value;
	if (jsonValue !== value) {
		const summarized = summarizeSignatureValue(jsonValue, key, depth, seen);
		seen.delete(value);
		return summarized;
	}

	if (Array.isArray(value)) {
		const summarized = value
			.slice(0, SIGNATURE_ARRAY_ITEM_LIMIT)
			.map((item, index) => summarizeSignatureValue(item, String(index), depth + 1, seen));
		if (value.length > SIGNATURE_ARRAY_ITEM_LIMIT) {
			const tailHash = hashSignatureValue(value.slice(SIGNATURE_ARRAY_ITEM_LIMIT));
			seen.delete(value);
			return [...summarized, `[+${value.length - SIGNATURE_ARRAY_ITEM_LIMIT} items hash=${tailHash}]`];
		}
		seen.delete(value);
		return summarized;
	}

	const summarized: Record<string, RenderSignatureValue> = {};
	const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
	for (const [key, item] of entries.slice(0, SIGNATURE_OBJECT_KEY_LIMIT)) {
		summarized[key] = summarizeSignatureValue(item, key, depth + 1, seen);
	}
	if (entries.length > SIGNATURE_OBJECT_KEY_LIMIT) {
		const omitted = entries.slice(SIGNATURE_OBJECT_KEY_LIMIT);
		summarized.__truncatedKeys = `[+${omitted.length} keys hash=${hashSignatureValue(Object.fromEntries(omitted))}]`;
	}
	seen.delete(value);
	return summarized;
}

function hasJsonSerializer(value: object): value is { toJSON: (key: string) => unknown } {
	return "toJSON" in value && typeof value.toJSON === "function";
}
