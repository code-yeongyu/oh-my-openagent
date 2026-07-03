import { Buffer } from "buffer";

const RESIDENT_STRING_MIN_BYTES = 32 * 1024;
const RESIDENT_STRING_PREFIX = "\u0000senpi-resident-string:v1:";
const OMIT_JSON_VALUE = Symbol("omit-json-value");

export interface ResidentStoreStats {
	blobCount: number;
	blobBytes: number;
}

export class ResidentStringStore {
	private strings = new Map<string, string>();
	private bytes = 0;
	private nextId = 0;

	clear(): void {
		this.strings.clear();
		this.bytes = 0;
		this.nextId = 0;
	}

	stats(): ResidentStoreStats {
		return {
			blobCount: this.strings.size,
			blobBytes: this.bytes,
		};
	}

	externalize<T>(value: T): T {
		return transformJson(value, (text) => this.externalizeString(text));
	}

	materialize<T>(value: T): T {
		return transformJson(value, (text) => this.materializeString(text));
	}

	private externalizeString(text: string): string {
		if (text.length < RESIDENT_STRING_MIN_BYTES || text.startsWith(RESIDENT_STRING_PREFIX)) {
			return text;
		}

		const id = `${this.nextId++}`;
		this.strings.set(id, text);
		this.bytes += Buffer.byteLength(text, "utf8");
		return `${RESIDENT_STRING_PREFIX}${id}`;
	}

	private materializeString(text: string): string {
		if (!text.startsWith(RESIDENT_STRING_PREFIX)) {
			return text;
		}

		const id = text.slice(RESIDENT_STRING_PREFIX.length);
		return this.strings.get(id) ?? text;
	}
}

function transformJson<T>(value: T, transformString: (text: string) => string): T {
	const transformed = transformJsonValue(value, transformString, "", new WeakSet());
	if (transformed === OMIT_JSON_VALUE) {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) {
			throw new SyntaxError("JSON-compatible value expected");
		}
		return JSON.parse(serialized) as T;
	}
	return transformed as T;
}

function transformJsonValue(
	value: unknown,
	transformString: (text: string) => string,
	key: string,
	seen: WeakSet<object>,
): unknown | typeof OMIT_JSON_VALUE {
	if (typeof value === "string") {
		return transformString(value);
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (value === null || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "bigint") {
		throw new TypeError("Do not know how to serialize a BigInt");
	}
	if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
		return OMIT_JSON_VALUE;
	}

	if (seen.has(value)) {
		throw new TypeError("Converting circular structure to JSON");
	}
	seen.add(value);

	const jsonValue = hasJsonSerializer(value) ? value.toJSON(key) : value;
	if (jsonValue !== value) {
		const transformed = transformJsonValue(jsonValue, transformString, key, seen);
		seen.delete(value);
		return transformed;
	}

	if (Array.isArray(value)) {
		const transformed = Array.from({ length: value.length }, (_item, index) => {
			const item = value[index];
			const transformedItem = transformJsonValue(item, transformString, String(index), seen);
			return transformedItem === OMIT_JSON_VALUE ? null : transformedItem;
		});
		seen.delete(value);
		return transformed;
	}

	const transformed: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		const transformedItem = transformJsonValue(item, transformString, key, seen);
		if (transformedItem !== OMIT_JSON_VALUE) {
			Object.defineProperty(transformed, key, {
				configurable: true,
				enumerable: true,
				value: transformedItem,
				writable: true,
			});
		}
	}
	seen.delete(value);
	return transformed;
}

function hasJsonSerializer(value: object): value is { toJSON: (key: string) => unknown } {
	return "toJSON" in value && typeof value.toJSON === "function";
}
