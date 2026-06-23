import type { Page } from "playwright-core"
import type { ChallengeKind } from "../types"
import type {
  CapsolverTaskType,
  CapsolverTurnstileMetadata,
  CapsolverGeeTestPayload,
  CapsolverEnterprisePayload,
  GetTaskResultResponse,
} from "./capsolver-client"

export type CapsolverExtraction = {
  websiteKey?: string
  data?: string
  metadata?: CapsolverTurnstileMetadata
  geetest?: CapsolverGeeTestPayload
  enterprise?: CapsolverEnterprisePayload
  enterprisePayload?: Record<string, unknown>
  userAgent?: string
  isInvisible?: boolean
  taskExtra?: Record<string, unknown>
}

export type CapsolverSolution = NonNullable<GetTaskResultResponse["solution"]>

export type CapsolverTaskHandler = {
  taskType: CapsolverTaskType
  extract(page: Page): Promise<CapsolverExtraction | null>
  inject(page: Page, solution: CapsolverSolution): Promise<boolean>
}

export type CapsolverRegistry = Record<ChallengeKind, CapsolverTaskHandler>
