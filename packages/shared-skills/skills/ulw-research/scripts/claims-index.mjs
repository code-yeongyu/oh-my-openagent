// claims-index.mjs - deterministic index of claim-graph.md: the one Markdown table whose header
// names claim_id, statement, risk tier, and status, plus the ids listed under the
// `## verified-claims` digest. Pure function of the text; node: builtins only.

const CLAIM_ID = /^C\d+$/
const REQUIRED_COLUMNS = Object.freeze({ claim_id: "claim_id", statement: "statement", risk: "risk tier", status: "status" })

/** Split one table line on unescaped pipes; drops the leading and trailing border cells. */
function splitRow(line) {
	const cells = []
	let current = ""
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index]
		if (char === "\\" && line[index + 1] === "|") {
			current += "|"
			index += 1
		} else if (char === "|") {
			cells.push(current)
			current = ""
		} else current += char
	}
	cells.push(current)
	const trimmed = cells.map((value) => value.trim())
	if (line.trim().startsWith("|")) trimmed.shift()
	if (line.trim().endsWith("|")) trimmed.pop()
	return trimmed
}

function normalizeHeader(value) {
	return value.replace(/`/g, "").trim().toLowerCase().replace(/[\s_-]+/g, " ")
}

function columnIndexes(header) {
	const names = header.map(normalizeHeader)
	const indexes = {}
	for (const [key, name] of Object.entries(REQUIRED_COLUMNS)) indexes[key] = names.indexOf(normalizeHeader(name))
	return Object.values(indexes).every((index) => index >= 0) ? indexes : null
}

function isSeparator(line) {
	return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)
}

const DIGEST_HEADING = normalizeHeader("verified-claims")

/** `offset` is the index of `lines[0]` in the document, for line numbers in errors. */
function verifiedIds(lines, offset, errors) {
	const ids = []
	let inside = false
	for (const [index, line] of lines.entries()) {
		const heading = /^(#{1,6})\s+(.*)$/.exec(line)
		if (heading) {
			const name = normalizeHeader(heading[2])
			inside = name === DIGEST_HEADING
			if (!inside && name.startsWith(DIGEST_HEADING)) {
				errors.push(`line ${offset + index + 1}: heading "${line.trim()}" is not the digest heading "## verified-claims"; drop the suffix so its entries are read`)
			}
			continue
		}
		if (!inside) continue
		// An entry is a list item or a table row; prose lines never verify. Only the id an entry
		// starts with is verified; ids mentioned later in the line are not.
		const leading = /^\s*(?:(?:[-*+]|\d+[.)])\s+|\|\s*)`?(C\d+)\b/.exec(line)
		if (leading && !ids.includes(leading[1])) ids.push(leading[1])
	}
	return ids
}

/** Blank every line of a fenced code block (``` or ~~~, fences included) so nothing in it is read. */
function unfenced(lines) {
	let fence = null
	return lines.map((line) => {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
		if (fence === null) {
			if (marker) fence = marker[1]
			return marker ? "" : line
		}
		const closes = marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]
		if (closes) fence = null
		return ""
	})
}

/** @returns {{ claims: { claim_id: string, statement: string, risk: string, status: string, in_verified: boolean }[], errors: string[] }} */
export function indexClaims(markdown) {
	const lines = unfenced(markdown.split(/\r?\n/))
	const errors = []
	const headerAt = lines.findIndex((line) => line.trim().startsWith("|") && columnIndexes(splitRow(line)) !== null)
	if (headerAt < 0) {
		return { claims: [], errors: ["no claim table: a Markdown table with claim_id, statement, risk tier, and status columns is required"] }
	}
	const header = splitRow(lines[headerAt])
	const columns = columnIndexes(header)
	const hasSeparator = isSeparator(lines[headerAt + 1] ?? "")
	if (!hasSeparator) errors.push(`line ${headerAt + 2}: claim table header must be followed by a separator row`)
	const firstRow = headerAt + (hasSeparator ? 2 : 1)
	const rows = []
	let tableEnd = firstRow
	for (let index = firstRow; index < lines.length && lines[index].trim().startsWith("|"); index += 1) {
		tableEnd = index + 1
		const cells = splitRow(lines[index])
		const at = `line ${index + 1}`
		if (cells.length !== header.length) {
			errors.push(`${at}: expected ${header.length} cells, found ${cells.length}`)
			continue
		}
		const claimId = cells[columns.claim_id].replace(/`/g, "")
		if (!CLAIM_ID.test(claimId)) {
			errors.push(`${at}: claim_id "${claimId}" must match C<n>`)
			continue
		}
		if (rows.some((row) => row.claim_id === claimId)) {
			errors.push(`${at}: duplicate claim_id ${claimId}`)
			continue
		}
		rows.push({ claim_id: claimId, statement: cells[columns.statement], risk: cells[columns.risk], status: cells[columns.status] })
	}
	// The digest section ends at the claim table: scan each side on its own so it cannot carry across.
	const verified = [...new Set([...verifiedIds(lines.slice(0, headerAt), 0, errors), ...verifiedIds(lines.slice(tableEnd), tableEnd, errors)])]
	for (const id of verified) {
		if (!rows.some((row) => row.claim_id === id)) errors.push(`verified-claims lists ${id}, which has no claim row`)
	}
	const claims = rows.map((row) => ({ ...row, in_verified: verified.includes(row.claim_id) }))
	return { claims, errors }
}
