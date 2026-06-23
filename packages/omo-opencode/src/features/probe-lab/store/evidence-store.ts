import type { Database } from "bun:sqlite"
import type { Evidence, NewEvidenceInput } from "../types"

export type EvidenceStore = ReturnType<typeof createEvidenceStore>

export function createEvidenceStore(db: Database) {
  function insert(input: NewEvidenceInput): Evidence {
    const result = db.run(
      `INSERT INTO evidence
          (hypothesis_id, session_id, exchange_id, verdict, confidence,
           reasoning, aspic_preference_impact, aspic_extensions_count,
           kb_entry_id, previous_evidence_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      [
        input.hypothesis_id,
        input.session_id,
        input.exchange_id ?? null,
        input.verdict,
        input.confidence ?? null,
        input.reasoning ?? null,
        input.aspic_preference_impact == null
          ? null
          : JSON.stringify(input.aspic_preference_impact),
        input.aspic_extensions_count ?? null,
        input.kb_entry_id ?? null,
        input.previous_evidence_id ?? null,
      ],
    )
    const id = Number(result.lastInsertRowid)
    return db.query<Evidence, [number]>(
      "SELECT * FROM evidence WHERE id = ?1",
    ).get(id)!
  }

  function setKbEntry(id: number, kbEntryId: string): void {
    db.run("UPDATE evidence SET kb_entry_id = ?2 WHERE id = ?1", [id, kbEntryId])
  }

  function setAspicExtensionsCount(id: number, count: number): void {
    db.run("UPDATE evidence SET aspic_extensions_count = ?2 WHERE id = ?1", [id, count])
  }

  function listForHypothesis(hypothesisId: string): Evidence[] {
    return db.query<Evidence, [string]>(
      "SELECT * FROM evidence WHERE hypothesis_id = ?1 ORDER BY created_at ASC",
    ).all(hypothesisId)
  }

  function getLatestForExchange(exchangeId: number): Evidence | null {
    return db.query<Evidence, [number]>(
      "SELECT * FROM evidence WHERE exchange_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
    ).get(exchangeId) ?? null
  }

  return { insert, setKbEntry, setAspicExtensionsCount, listForHypothesis, getLatestForExchange }
}
