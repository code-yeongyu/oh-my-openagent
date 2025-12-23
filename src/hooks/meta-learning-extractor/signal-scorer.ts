import type {
  SignalScoring,
  StrongSignalName,
  MediumSignalName,
  WeakSignalName,
  VetoConditionName,
  SignalDetection,
} from "../../features/context-learning/types"

const MEMORY_FILE_PATTERNS = [
  /\.cursor\/memory\//,
  /context\/memory\//,
  /\.opencode\/memory\//,
  /AGENTS\.md$/,
  /constitution\.md$/,
  /architecture\.md$/,
  /tech-stack\.md$/,
  /glossary\.md$/,
]

const SHARED_UTILITY_PATTERNS = [
  /shared\//,
  /utils\//,
  /helpers\//,
  /lib\//,
  /common\//,
]

const CONFIG_FILE_PATTERNS = [
  /\.json$/,
  /\.ya?ml$/,
  /\.toml$/,
  /\.env/,
  /config\//,
]

const DEPENDENCY_PATTERNS = [/package\.json$/, /bun\.lock$/, /yarn\.lock$/, /pnpm-lock\.yaml$/]

const DECISION_KEYWORDS = [
  "decided to",
  "chose",
  "selected",
  "opted for",
  "went with",
  "because",
  "tradeoff",
  "trade-off",
  "instead of",
  "rather than",
  "better approach",
  "more appropriate",
]

const PATTERN_KEYWORDS = [
  "pattern",
  "always",
  "never",
  "should",
  "must",
  "convention",
  "standard",
  "consistently",
  "rule",
  "practice",
]

const ENV_SPECIFIC_KEYWORDS = ["my machine", "locally", "on my", "specific to", "only works on", "env var"]

const SPECULATION_KEYWORDS = ["might", "maybe", "probably", "could be", "possibly", "not sure", "uncertain"]

export function computeSignalScore(
  messages: Array<{ role: string; content: string }>,
  filesModified: string[],
  toolsUsed: string[]
): SignalScoring {
  const allContent = messages.map((m) => m.content).join("\n")

  const strongSignals = detectStrongSignals(filesModified, allContent)
  const mediumSignals = detectMediumSignals(filesModified, allContent)
  const weakSignals = detectWeakSignals(filesModified, allContent)
  const vetoConditions = detectVetoConditions(filesModified, allContent)

  const strongScore = strongSignals.filter((s) => s.detected).length * 3
  const mediumScore = mediumSignals.filter((s) => s.detected).length * 2
  const weakScore = weakSignals.filter((s) => s.detected).length * 1

  const rawScore = strongScore + mediumScore + weakScore
  const totalScore = Math.min(rawScore, 10)
  const hasVeto = vetoConditions.some((v) => v.detected)

  return {
    strongSignals,
    mediumSignals,
    weakSignals,
    vetoConditions,
    totalScore,
    threshold: 3,
    shouldTrigger: totalScore >= 3 && !hasVeto,
  }
}

function detectStrongSignals(filesModified: string[], content: string): SignalDetection<StrongSignalName>[] {
  const memoryFiles = filesModified.filter((f) => MEMORY_FILE_PATTERNS.some((p) => p.test(f)))

  const sharedFiles = filesModified.filter((f) => SHARED_UTILITY_PATTERNS.some((p) => p.test(f)))

  const hasArchitecturalDecisions =
    content.includes("architecture") || content.includes("refactor") || content.includes("restructure")

  const uniqueDirs = new Set(filesModified.map((f) => f.split("/").slice(0, -1).join("/")))
  const hasCrossFileRefactoring = uniqueDirs.size >= 3 && filesModified.length >= 5

  return [
    {
      name: "edited_memory_files",
      detected: memoryFiles.length > 0,
      evidence: memoryFiles,
    },
    {
      name: "created_shared_utilities",
      detected: sharedFiles.length > 0,
      evidence: sharedFiles,
    },
    {
      name: "architectural_decisions",
      detected: hasArchitecturalDecisions,
      evidence: hasArchitecturalDecisions ? ["Content contains architectural keywords"] : undefined,
    },
    {
      name: "cross_file_refactoring",
      detected: hasCrossFileRefactoring,
      evidence: hasCrossFileRefactoring ? [`${uniqueDirs.size} directories, ${filesModified.length} files`] : undefined,
    },
  ]
}

function detectMediumSignals(filesModified: string[], content: string): SignalDetection<MediumSignalName>[] {
  const lowerContent = content.toLowerCase()

  const decisionMatches = DECISION_KEYWORDS.filter((kw) => lowerContent.includes(kw))
  const hasDecisionLanguage = decisionMatches.length >= 2

  const patternMatches = PATTERN_KEYWORDS.filter((kw) => lowerContent.includes(kw))
  const hasPatternIdentification = patternMatches.length >= 2

  const uniqueDirs = new Set(filesModified.map((f) => f.split("/").slice(0, -1).join("/")))
  const hasCrossFileImpact = uniqueDirs.size >= 2 && filesModified.length >= 3

  return [
    {
      name: "decision_language",
      detected: hasDecisionLanguage,
      evidence: hasDecisionLanguage ? decisionMatches : undefined,
    },
    {
      name: "pattern_identification",
      detected: hasPatternIdentification,
      evidence: hasPatternIdentification ? patternMatches : undefined,
    },
    {
      name: "cross_file_impact",
      detected: hasCrossFileImpact,
      evidence: hasCrossFileImpact ? [`${uniqueDirs.size} directories affected`] : undefined,
    },
  ]
}

function detectWeakSignals(filesModified: string[], content: string): SignalDetection<WeakSignalName>[] {
  const extensions = new Set(filesModified.map((f) => f.split(".").pop() || ""))
  const hasNewFileTypes = extensions.size >= 3

  const configFiles = filesModified.filter((f) => CONFIG_FILE_PATTERNS.some((p) => p.test(f)))
  const hasConfigChanges = configFiles.length > 0

  const depFiles = filesModified.filter((f) => DEPENDENCY_PATTERNS.some((p) => p.test(f)))
  const hasDependencyChanges = depFiles.length > 0

  return [
    {
      name: "new_file_types",
      detected: hasNewFileTypes,
      evidence: hasNewFileTypes ? Array.from(extensions) : undefined,
    },
    {
      name: "config_changes",
      detected: hasConfigChanges,
      evidence: hasConfigChanges ? configFiles : undefined,
    },
    {
      name: "dependency_changes",
      detected: hasDependencyChanges,
      evidence: hasDependencyChanges ? depFiles : undefined,
    },
  ]
}

function detectVetoConditions(filesModified: string[], content: string): SignalDetection<VetoConditionName>[] {
  const lowerContent = content.toLowerCase()

  const isSingleFileChange = filesModified.length <= 1

  const envMatches = ENV_SPECIFIC_KEYWORDS.filter((kw) => lowerContent.includes(kw))
  const isEnvironmentSpecific = envMatches.length >= 2

  const specMatches = SPECULATION_KEYWORDS.filter((kw) => lowerContent.includes(kw))
  const isSpeculation = specMatches.length >= 3

  return [
    {
      name: "single_file_change",
      detected: isSingleFileChange,
      reason: isSingleFileChange ? "Only modified 1 file or fewer" : undefined,
    },
    {
      name: "environment_specific",
      detected: isEnvironmentSpecific,
      reason: isEnvironmentSpecific ? `Environment keywords: ${envMatches.join(", ")}` : undefined,
    },
    {
      name: "speculation",
      detected: isSpeculation,
      reason: isSpeculation ? `Speculation keywords: ${specMatches.join(", ")}` : undefined,
    },
  ]
}

export function formatSignalReport(scoring: SignalScoring): string {
  const lines: string[] = []
  lines.push(`## Signal Score: ${scoring.totalScore}/10 (threshold: ${scoring.threshold})`)
  lines.push(`**Should Trigger**: ${scoring.shouldTrigger ? "Yes" : "No"}`)
  lines.push("")

  const detected = (s: SignalDetection<string>) => (s.detected ? "✓" : "✗")

  lines.push("### Strong Signals (3 pts each)")
  scoring.strongSignals.forEach((s) => {
    lines.push(`- ${detected(s)} ${s.name}${s.evidence ? `: ${s.evidence.slice(0, 2).join(", ")}` : ""}`)
  })

  lines.push("")
  lines.push("### Medium Signals (2 pts each)")
  scoring.mediumSignals.forEach((s) => {
    lines.push(`- ${detected(s)} ${s.name}${s.evidence ? `: ${s.evidence.slice(0, 2).join(", ")}` : ""}`)
  })

  lines.push("")
  lines.push("### Weak Signals (1 pt each)")
  scoring.weakSignals.forEach((s) => {
    lines.push(`- ${detected(s)} ${s.name}${s.evidence ? `: ${s.evidence.slice(0, 2).join(", ")}` : ""}`)
  })

  const vetoes = scoring.vetoConditions.filter((v) => v.detected)
  if (vetoes.length > 0) {
    lines.push("")
    lines.push("### Veto Conditions (BLOCKING)")
    vetoes.forEach((v) => {
      lines.push(`- ⚠️ ${v.name}: ${v.reason || "triggered"}`)
    })
  }

  return lines.join("\n")
}
