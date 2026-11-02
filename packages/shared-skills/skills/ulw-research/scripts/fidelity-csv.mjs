// Read fact export CSV records, including quoted commas, escaped quotes and newlines.
import { existsSync, readFileSync } from "node:fs"

export function readCsv(path) {
	if (!existsSync(path)) return null
	const text = readFileSync(path, "utf8")
	const records = []
	let cells = []
	let cell = ""
	let quoted = false
	for (let i = 0; i <= text.length; i++) {
		const char = text[i]
		if (char === '"') {
			if (quoted && text[i + 1] === '"') {
				cell += '"'
				i++
			} else quoted = !quoted
		} else if (!quoted && (char === "," || char === "\n" || char === undefined)) {
			cells.push(cell.trim())
			cell = ""
			if (char !== ",") {
				if (cells.some((value) => value !== "")) records.push(cells)
				cells = []
			}
		} else if (char !== undefined) cell += char
	}
	if (quoted) return null
	const [head = [], ...rows] = records
	const [id, value, unit] = ["fact_id", "plot_value", "unit"].map((name) => head.indexOf(name))
	if (id < 0 || value < 0 || unit < 0 || rows.length === 0) return null
	return rows.map((c) => ({ fact_id: c[id], plot_value: c[value], unit: c[unit] ?? "" }))
}
