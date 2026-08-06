import { invalid, literal, textField } from "./quality-gate-fields.js";

export function passedVerdict(value: unknown, field: string): "passed" {
	if (value === "not_applicable") invalid(`${field} must not be not_applicable.`, field);
	return literal(value, "passed", field);
}

export function codeQualityStatusField(value: unknown, field: string): "CLEAR" | "WATCH" {
	if (value === "CLEAR" || value === "WATCH") return value;
	invalid(`${field} must be CLEAR or WATCH.`, field);
}

export function adversarialVerdict(
	row: Record<string, unknown>,
	field: string,
): { verdict: "passed" | "not_applicable"; reason?: string } {
	const value = row["verdict"];
	if (value === "passed") return { verdict: "passed" };
	if (value === "not_applicable") {
		return { verdict: "not_applicable", reason: textField(row["reason"], `${field}.reason`) };
	}
	invalid(`${field} must be passed or not_applicable with a reason.`, field);
}
