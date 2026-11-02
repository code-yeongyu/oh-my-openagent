// Metadata contracts and order-independent JSON equality, shared by schema and algebra.
import { isDeepStrictEqual } from "node:util"
import { refuse } from "./unit-errors.mjs"

export const METADATA = ["population", "accounting_basis", "snapshot_window", "entity", "valid_at"]
export const sameDeclared = isDeepStrictEqual
export const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0
export const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

export function metadataErrors(row) {
	return METADATA.filter((field) => {
		const value = row[field]
		return value !== null && !(nonEmpty(value) || (["population", "snapshot_window"].includes(field) && object(value)))
	}).map((field) => `${field} must be explicitly null or valid non-empty metadata`)
}

export function checkMetadata(rows, fields) {
	for (const row of rows) {
		const errors = metadataErrors(row)
		if (errors.length) refuse(`${row.fact_id}: ${errors.join("; ")}`, undefined, "metadata", "present, type-valid metadata; explicit null when unknown")
	}
	for (const field of fields) {
		if (rows.some((row) => !sameDeclared(row[field], rows[0][field]))) {
			refuse(`${field} differs across ${rows.map((row) => row.fact_id).join(", ")}`, undefined, "metadata", `equal ${field}`)
		}
	}
}

export function propagatedMetadata(rows) {
	return Object.fromEntries(METADATA.map((field) => [field, rows.every((row) => sameDeclared(row[field], rows[0][field])) ? structuredClone(rows[0][field]) : null]))
}
