export function parseJsonc(content) {
	try {
		return { ok: true, value: JSON.parse(stripTrailingCommas(stripJsonComments(content))) };
	} catch (error) {
		if (error instanceof Error) return { ok: false, error };
		throw error;
	}
}

export function stripJsonComments(content) {
	let result = "";
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		const next = content[index + 1];
		if (char === "\"") {
			const end = stringEnd(content, index);
			result += content.slice(index, end);
			index = end - 1;
		} else if (char === "/" && next === "/") {
			while (index < content.length && content[index] !== "\n") index += 1;
			result += "\n";
		} else if (char === "/" && next === "*") {
			index += 2;
			while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) index += 1;
			index += 1;
		} else {
			result += char;
		}
	}
	return result;
}

export function stringEnd(content, start) {
	for (let index = start + 1; index < content.length; index += 1) {
		if (content[index] === "\\") index += 1;
		else if (content[index] === "\"") return index + 1;
	}
	return content.length;
}

function stripTrailingCommas(content) {
	return content.replace(/,\s*([}\]])/g, "$1");
}
