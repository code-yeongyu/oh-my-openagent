/**
 * Deploy skill types for enterprise deployment workflows
 */

export type DeploySubcommand = "release" | "rollback" | "status" | "diff"

export interface ReleaseInput {
  /** Service or application to deploy */
  service: string
  /** Target environment (production, staging, dev) */
  environment: string
  /** Version or image tag to deploy */
  version?: string
  /** Deployment strategy (blue-green, canary, rolling) */
  strategy?: "blue-green" | "canary" | "rolling"
  /** Percentage of traffic for canary deployments */
  canaryPercentage?: number
  /** Dry run mode - show what would be deployed without executing */
  dryRun?: boolean
}

export interface ReleaseResult {
  /** Deployment ID or reference */
  deploymentId: string
  /** Current status */
  status: DeploymentStatus
  /** Deployed version */
  version: string
  /** Target environment */
  environment: string
  /** Deployment timeline */
  timeline: DeploymentEvent[]
  /** Health check results */
  healthChecks: HealthCheck[]
  /** Rollback information if available */
  rollbackInfo?: RollbackInfo
}

export interface RollbackInput {
  /** Service to rollback */
  service: string
  /** Target environment */
  environment: string
  /** Version to rollback to (defaults to previous stable) */
  targetVersion?: string
  /** Reason for rollback */
  reason?: string
  /** Force rollback without confirmation */
  force?: boolean
}

export interface RollbackResult {
  /** Rollback operation ID */
  rollbackId: string
  /** Current status */
  status: DeploymentStatus
  /** Version rolled back from */
  fromVersion: string
  /** Version rolled back to */
  toVersion: string
  /** Rollback duration in seconds */
  duration: number
  /** Any issues encountered */
  issues: string[]
}

export interface StatusInput {
  /** Service to check (optional, all services if not specified) */
  service?: string
  /** Environment to check */
  environment?: string
  /** Include deployment history */
  includeHistory?: boolean
  /** Number of historical deployments to include */
  historyLimit?: number
}

export interface StatusResult {
  /** Services status */
  services: ServiceStatus[]
  /** Overall environment health */
  environmentHealth: "healthy" | "degraded" | "unhealthy"
  /** Active deployments in progress */
  activeDeployments: DeploymentInfo[]
  /** Recent deployment history */
  history?: DeploymentInfo[]
}

export interface DiffInput {
  /** Service to compare */
  service: string
  /** Source environment or version */
  source: string
  /** Target environment or version */
  target: string
  /** Types of changes to include */
  include?: ("config" | "image" | "resources" | "secrets")[]
}

export interface DiffResult {
  /** Service being compared */
  service: string
  /** Source reference */
  source: string
  /** Target reference */
  target: string
  /** List of differences */
  differences: Difference[]
  /** Summary of changes */
  summary: DiffSummary
}

export interface Difference {
  /** Type of change */
  type: "added" | "removed" | "modified"
  /** Category of the difference */
  category: "config" | "image" | "resources" | "secrets" | "environment"
  /** Path or key of the changed item */
  path: string
  /** Old value (for modified/removed) */
  oldValue?: string
  /** New value (for modified/added) */
  newValue?: string
}

export interface DiffSummary {
  /** Number of additions */
  added: number
  /** Number of removals */
  removed: number
  /** Number of modifications */
  modified: number
  /** Risk assessment */
  riskLevel: "low" | "medium" | "high"
  /** Risk explanation */
  riskExplanation?: string
}

export type DeploymentStatus =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "rolling_back"
  | "rolled_back"
  | "cancelled"

export interface DeploymentEvent {
  /** Timestamp */
  timestamp: string
  /** Event type */
  type: "started" | "progress" | "health_check" | "completed" | "failed" | "rollback"
  /** Event message */
  message: string
  /** Additional details */
  details?: Record<string, unknown>
}

export interface DeploymentInfo {
  /** Deployment ID */
  id: string
  /** Service name */
  service: string
  /** Environment */
  environment: string
  /** Deployed version */
  version: string
  /** Status */
  status: DeploymentStatus
  /** Start time */
  startedAt: string
  /** Completion time */
  completedAt?: string
  /** Duration in seconds */
  duration?: number
  /** Deployer (user or automation) */
  deployedBy: string
}

export interface HealthCheck {
  /** Check name */
  name: string
  /** Status */
  status: "passing" | "failing" | "pending"
  /** Last check time */
  lastCheck: string
  /** Response time in ms */
  responseTime?: number
  /** Error message if failing */
  error?: string
}

export interface RollbackInfo {
  /** Can rollback */
  available: boolean
  /** Previous stable version */
  previousVersion?: string
  /** Time since last stable deployment */
  timeSinceStable?: string
  /** Estimated rollback time */
  estimatedDuration?: string
}

export interface ServiceStatus {
  /** Service name */
  name: string
  /** Current version */
  version: string
  /** Environment */
  environment: string
  /** Health status */
  health: "healthy" | "degraded" | "unhealthy"
  /** Number of running instances */
  instances: number
  /** Desired instances */
  desiredInstances: number
  /** Last deployment time */
  lastDeployedAt: string
  /** Active alerts */
  alerts: string[]
}

export interface DeployConfig {
  /** AWS configuration */
  aws?: {
    region?: string
    profile?: string
    assumeRole?: string
  }
  /** Terraform configuration */
  terraform?: {
    workingDir?: string
    backend?: string
    varFile?: string
  }
  /** Default environment */
  defaultEnvironment?: string
  /** Default deployment strategy */
  defaultStrategy?: "blue-green" | "canary" | "rolling"
}
