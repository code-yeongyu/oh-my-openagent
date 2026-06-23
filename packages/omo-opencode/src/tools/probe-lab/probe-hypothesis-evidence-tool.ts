import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  recordConfirmation,
  recordRefutation,
} from "../../features/probe-lab/falsification-writer"
import { decideHypothesisStatus, type Decision } from "../../features/probe-lab/hypothesis-status-decider"
import { derivePianoDPreferences } from "../../features/probe-lab/piano-d-preference-deriver"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import type { Hypothesis, HypothesisStatus, ProbeExchange } from "../../features/probe-lab/types"

const DESCRIPTION = `Link probe exchanges to a hypothesis as evidence with a verdict (supports / refutes / inconclusive).

When run_reasoning_core=true and the hypothesis has an aspic_theory_template, the verdict is enriched into a fresh ASPIC+ premise (supports/refutes(evidence(<id>))) and evaluated via reason_argue with the requested aspic_semantics. Piano D preferences are derived from prior evidence verdicts and injected automatically.

Multi-extension handling (preferred/stable/complete): if reason_argue returns 2+ accepted extensions while the verdict is refuted/confirmed in any one, the hypothesis is flagged uncertainty_label='high' and status remains active rather than finalising.

Validates ALL exchange_ids exist BEFORE inserting any evidence (atomic via SQLite transaction). On any missing id the call rejects with no partial writes.`

const HYPOTHESIS_DESC = "Hypothesis id returned by probe_hypothesis_add"
const EXCHANGE_IDS_DESC = "Exchange ids (from probe_run results) to attach as evidence"
const VERDICT_DESC = "'supports' weighs the hypothesis up, 'refutes' down (and dominates priors), 'inconclusive' is recorded without weight"
const REASONING_DESC = "Optional human-readable explanation chain"
const RUN_RC_DESC = "If true and an aspic_theory_template exists on the hypothesis, evaluate via reason_argue. Otherwise the cumulative-verdict fallback is used."
const SEMANTICS_DESC = "ASPIC+ semantics: grounded (default) for unique extension; preferred/stable/complete may produce multi-extension uncertainty"

export function createProbeHypothesisEvidenceTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      hypothesis_id: tool.schema.string().describe(HYPOTHESIS_DESC),
      exchange_ids: tool.schema.array(tool.schema.number().int()).min(1).max(50).describe(EXCHANGE_IDS_DESC),
      verdict: tool.schema.enum(["supports", "refutes", "inconclusive"]).describe(VERDICT_DESC),
      reasoning: tool.schema.string().max(2000).optional().describe(REASONING_DESC),
      run_reasoning_core: tool.schema.boolean().default(false).describe(RUN_RC_DESC),
      aspic_semantics: tool.schema.enum(["grounded", "preferred", "stable", "complete"]).default("grounded").describe(SEMANTICS_DESC),
    },
    async execute(args) {
      try {
        const hypothesis = ctx.store.getHypothesis(args.hypothesis_id)
        if (!hypothesis) return `[ERROR] hypothesis not found: ${args.hypothesis_id}`
        const previousStatus: HypothesisStatus = hypothesis.status
        const exchanges = collectExchanges(ctx, args.exchange_ids)
        if (typeof exchanges === "string") return exchanges
        const inserted = insertEvidenceRows(ctx, hypothesis.id, exchanges, args.verdict, args.reasoning)
        const decision = await runDecider(ctx, hypothesis, args, inserted[inserted.length - 1]!)
        ctx.store.updateHypothesisStatus(hypothesis.id, decision.status, decision.confidence)
        if (decision.uncertaintyLabel) {
          ctx.store.setHypothesisUncertaintyLabel(hypothesis.id, decision.uncertaintyLabel)
        }
        if (decision.extensionsCount != null) {
          for (const evidenceId of inserted) {
            ctx.store.setEvidenceAspicExtensionsCount(evidenceId, decision.extensionsCount)
          }
        }
        const refreshed = ctx.store.getHypothesis(hypothesis.id)!
        const kbEntries = await maybeWriteKb(refreshed, previousStatus, inserted, args.reasoning)
        for (const { evidence_id, kb_entry_id } of kbEntries) {
          if (kb_entry_id) ctx.store.setEvidenceKbEntry(evidence_id, kb_entry_id)
        }
        return JSON.stringify({
          evidence_ids: inserted,
          hypothesis_status: refreshed.status,
          previous_status: previousStatus,
          confidence: refreshed.confidence,
          decision_source: decision.source,
          aspic_extensions_count: decision.extensionsCount,
          uncertainty_label: refreshed.uncertainty_label,
          kb_entries_added: kbEntries.map((k) => k.kb_entry_id).filter((id): id is string => id != null),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_hypothesis_evidence failed: ${message}`
      }
    },
  })
}

function collectExchanges(ctx: ProbeLabContext, ids: ReadonlyArray<number>): ProbeExchange[] | string {
  const exchanges: ProbeExchange[] = []
  for (const exchangeId of ids) {
    const exchange = ctx.store.getExchange(exchangeId)
    if (!exchange) return `[ERROR] exchange not found: ${exchangeId}`
    exchanges.push(exchange)
  }
  return exchanges
}

function insertEvidenceRows(
  ctx: ProbeLabContext,
  hypothesisId: string,
  exchanges: ProbeExchange[],
  verdict: "supports" | "refutes" | "inconclusive",
  reasoning: string | undefined,
): number[] {
  return ctx.store.transaction((): number[] => {
    const ids: number[] = []
    for (const exchange of exchanges) {
      const evidence = ctx.store.insertEvidence({
        hypothesis_id: hypothesisId,
        session_id: exchange.session_id,
        exchange_id: exchange.id,
        verdict,
        reasoning: reasoning ?? null,
      })
      ids.push(evidence.id)
    }
    return ids
  })
}

async function runDecider(
  ctx: ProbeLabContext,
  hypothesis: Hypothesis,
  args: { verdict: "supports" | "refutes" | "inconclusive"; run_reasoning_core: boolean; aspic_semantics: "grounded" | "preferred" | "stable" | "complete" },
  latestEvidenceId: number,
): Promise<Decision> {
  const evidenceHistory = ctx.store.listEvidenceForHypothesis(hypothesis.id)
  const aspicPreferences = derivePianoDPreferences(evidenceHistory)
  return decideHypothesisStatus({
    hypothesis,
    evidenceHistory,
    latestVerdict: args.verdict,
    latestEvidenceId,
    runReasoningCore: args.run_reasoning_core,
    aspicSemantics: args.aspic_semantics,
    aspicPreferences,
  })
}

async function maybeWriteKb(
  refreshed: Hypothesis,
  previousStatus: HypothesisStatus,
  evidenceIds: number[],
  reasoning: string | null | undefined,
): Promise<Array<{ evidence_id: number; kb_entry_id: string | null }>> {
  if (refreshed.status === previousStatus) {
    return evidenceIds.map((id) => ({ evidence_id: id, kb_entry_id: null }))
  }
  const head = evidenceIds[0]!
  const rest = evidenceIds.slice(1).map((id) => ({ evidence_id: id, kb_entry_id: null }))
  if (refreshed.status === "refuted") {
    const out = await recordRefutation({ hypothesis: refreshed, evidenceId: head, reasoning })
    return [{ evidence_id: head, kb_entry_id: out.kb_entry_id }, ...rest]
  }
  if (refreshed.status === "confirmed") {
    const out = await recordConfirmation({ hypothesis: refreshed, evidenceId: head, reasoning })
    return [{ evidence_id: head, kb_entry_id: out.kb_entry_id }, ...rest]
  }
  return evidenceIds.map((id) => ({ evidence_id: id, kb_entry_id: null }))
}
