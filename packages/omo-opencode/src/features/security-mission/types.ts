import { z } from "zod"

export const ProvenanceSchema = z.enum(["none", "context", "tool"])
export type Provenance = z.infer<typeof ProvenanceSchema>

export const EvidenceLevelSchema = z.enum([
  "claimed",
  "source-verified",
  "poc-built",
  "poc-executed",
])
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>

export const SeveritySchema = z.enum([
  "info",
  "low",
  "medium",
  "high",
  "critical",
])
export type Severity = z.infer<typeof SeveritySchema>

export const MissionStatusSchema = z.enum([
  "defined",
  "scoped",
  "active",
  "reported",
  "completed",
])
export type MissionStatus = z.infer<typeof MissionStatusSchema>

export const FindingStatusSchema = z.enum([
  "claimed",
  "verified",
  "refuted",
  "reported",
])
export type FindingStatus = z.infer<typeof FindingStatusSchema>

export const EvidenceSchema = z.object({
  kind: z.string(),
  content: z.string(),
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const VerifyGateSchema = z.object({
  passed: z.boolean(),
  provenance: ProvenanceSchema,
  reasons: z.array(z.string()),
  checked_at: z.string(),
})
export type VerifyGate = z.infer<typeof VerifyGateSchema>

export const FindingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    severity: SeveritySchema,
    cwe: z.string().optional(),
    cvss_vector: z.string().optional(),
    evidence: z.array(EvidenceSchema).default([]),
    evidence_level: EvidenceLevelSchema.default("claimed"),
    remediation: z.string().optional(),
    references: z.array(z.string()).default([]),
    target_id: z.string().optional(),
    discovered_at: z.string(),
    verified_at: z.string().optional(),
    status: FindingStatusSchema.default("claimed"),
    verify_gate: VerifyGateSchema.optional(),
  })
  .refine(
    (f) => f.status !== "verified" || f.verify_gate !== undefined,
    { message: "verified findings must carry a verify_gate" },
  )
export type Finding = z.infer<typeof FindingSchema>

export const ScopeEntrySchema = z.object({
  host: z.string(),
  label: z.string().optional(),
})
export type ScopeEntry = z.infer<typeof ScopeEntrySchema>

export const MissionScopeSchema = z.object({
  allowed_hosts: z.array(ScopeEntrySchema).default([]),
  allowed_paths: z.array(z.string()).default([]),
  allow_loopback: z.boolean().default(false),
  allow_private: z.boolean().default(false),
})
export type MissionScope = z.infer<typeof MissionScopeSchema>

export const MissionSchema = z.object({
  id: z.string(),
  name: z.string(),
  objective: z.string(),
  scope: MissionScopeSchema,
  status: MissionStatusSchema.default("defined"),
  created_at: z.string(),
  completed_at: z.string().optional(),
  findings: z.array(FindingSchema).default([]),
})
export type Mission = z.infer<typeof MissionSchema>

export const CreateMissionInputSchema = z.object({
  name: z.string(),
  objective: z.string(),
  scope: MissionScopeSchema.partial().optional(),
})
export type CreateMissionInput = z.infer<typeof CreateMissionInputSchema>

export const AddFindingInputSchema = z.object({
  mission_id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: SeveritySchema,
  cwe: z.string().optional(),
  cvss_vector: z.string().optional(),
  evidence: z.array(EvidenceSchema).default([]),
  remediation: z.string().optional(),
  references: z.array(z.string()).default([]),
  target_id: z.string().optional(),
})
export type AddFindingInput = z.infer<typeof AddFindingInputSchema>

export const VerifyFindingInputSchema = z.object({
  mission_id: z.string(),
  finding_id: z.string(),
})
export type VerifyFindingInput = z.infer<typeof VerifyFindingInputSchema>

export const GenerateReportInputSchema = z.object({
  mission_id: z.string(),
  format: z.enum(["summary", "disclosure"]).default("summary"),
})
export type GenerateReportInput = z.infer<typeof GenerateReportInputSchema>
