import type {
  KnowledgeType,
  KnowledgeLayer,
  Severity,
  KnowledgeCommit,
  KnowledgeQueryFilter,
  Constraint,
} from "../../features/knowledge-repo/types"

export interface QueryInput {
  query?: string
  type?: KnowledgeType | KnowledgeType[]
  layer?: KnowledgeLayer | KnowledgeLayer[]
  severity?: Severity | Severity[]
  tags?: string[]
  limit?: number
}

export interface ListInput {
  layer?: KnowledgeLayer
  type?: KnowledgeType
  verbose?: boolean
}

export interface ShowInput {
  id: string
  includeConstraints?: boolean
  includeHistory?: boolean
}

export interface ProposeInput {
  type: KnowledgeType
  title: string
  summary: string
  content: string
  layer?: KnowledgeLayer
  severity?: Severity
  tags?: string[]
  constraints?: Array<{
    operator: string
    target: string
    pattern: string
    message?: string
    severity?: Severity
    appliesTo?: string[]
  }>
}

export interface QueryOutput {
  total: number
  items: Array<{
    id: string
    type: KnowledgeType
    layer: KnowledgeLayer
    title: string
    summary: string
    severity: Severity
    tags: string[]
  }>
  hasMore: boolean
}

export interface ListOutput {
  byLayer: Record<KnowledgeLayer, number>
  byType: Record<KnowledgeType, number>
  items: Array<{
    id: string
    type: KnowledgeType
    layer: KnowledgeLayer
    summary: string
    severity: Severity
  }>
}

export interface ShowOutput {
  knowledge: KnowledgeCommit
  history?: Array<{
    id: string
    createdAt: string
    author: string
  }>
}

export interface ProposeOutput {
  success: boolean
  knowledgeId?: string
  message: string
  preview?: {
    title: string
    type: KnowledgeType
    layer: KnowledgeLayer
    constraintCount: number
  }
}
