import type { Deviation } from "./deviation-detector"
import { log } from "../../shared/logger"

export type GateAction = "continue" | "warn" | "block"

export interface GateDecision {
  action: GateAction
  deviations: Deviation[]
  message: string
  injectedWarning?: string
}

function getWorstSeverity(deviations: Deviation[]): "leve" | "media" | "grave" {
  if (deviations.some((d) => d.severity === "grave")) return "grave"
  if (deviations.some((d) => d.severity === "media")) return "media"
  return "leve"
}

function buildDecisionMessage(deviations: Deviation[]): string {
  const lines: string[] = []
  lines.push("[Moderator Gate]")

  const worst = getWorstSeverity(deviations)
  if (worst === "grave") {
    lines.push("Action: RECOMMENDED PAUSE")
    lines.push("Detected potential architectural or dangerous change.")
  } else if (worst === "media") {
    lines.push("Action: FLAGGED FOR REVIEW")
    lines.push("Detected notable change — review recommended before continuing.")
  } else {
    lines.push("Action: LOGGED")
    lines.push("Minor deviation detected — no action needed.")
  }

  lines.push("")
  for (const d of deviations) {
    const icon = d.severity === "grave" ? "🔴" : d.severity === "media" ? "🟡" : "🟢"
    lines.push(`${icon} [${d.severity.toUpperCase()}] ${d.category}: ${d.detail}`)
  }

  return lines.join("\n")
}

function buildWarningMessage(deviations: Deviation[]): string {
  const worst = getWorstSeverity(deviations)

  if (worst === "grave") {
    return [
      "",
      "⚠️ [Moderator Gate] Se detectó un cambio potencialmente peligroso o arquitectónico.",
      "Revisa el reporte de desviaciones arriba antes de continuar.",
      "Si estás seguro, puedes ignorar esta advertencia y continuar.",
      "",
    ].join("\n")
  }

  if (worst === "media") {
    return [
      "",
      "ℹ️ [Moderator Gate] Cambio notable detectado (ver reporte arriba).",
      "Se recomienda revisión antes de continuar.",
      "",
    ].join("\n")
  }

  return ""
}

export function evaluateDeviations(deviations: Deviation[]): GateDecision {
  if (deviations.length === 0) {
    return {
      action: "continue",
      deviations: [],
      message: "[Moderator Gate] No deviations detected. Continuing.",
    }
  }

  const worst = getWorstSeverity(deviations)

  log(`[moderator-gate] Evaluating ${deviations.length} deviation(s), worst=${worst}`, {
    deviationCount: deviations.length,
    worstSeverity: worst,
    categories: [...new Set(deviations.map((d) => d.category))],
  })

  let action: GateAction
  let injectedWarning: string | undefined

  switch (worst) {
    case "grave":
      action = "warn"
      injectedWarning = buildWarningMessage(deviations)
      break
    case "media":
      action = "warn"
      injectedWarning = buildWarningMessage(deviations)
      break
    case "leve":
    default:
      action = "continue"
      break
  }

  // Grave deviations with config changes should block
  const hasConfigChange = deviations.some(
    (d) => d.category === "config-change" || d.category === "protected-area-write",
  )
  if (hasConfigChange) {
    action = "warn"
    injectedWarning = buildWarningMessage(deviations)
  }

  return {
    action,
    deviations,
    message: buildDecisionMessage(deviations),
    injectedWarning,
  }
}
