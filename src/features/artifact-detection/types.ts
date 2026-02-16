export type ArtifactClass =
  | "boulder-plan"
  | "sisyphus-plan"
  | "sisyphus-draft"
  | "context-file"
  | "hooks-config"
  | "opencode-skill"

export interface DetectedArtifact {
  class: ArtifactClass
  path: string
  relativePath: string
  contentHash: string
  detectedAt: number
  sizeBytes: number
}

export interface ArtifactScanResult {
  projectDir: string
  artifacts: DetectedArtifact[]
  scanDuration: number
  errors: string[]
}

export interface IngestionRecord {
  artifactHash: string
  ingestedAt: number
  mcbCollection: string
}
