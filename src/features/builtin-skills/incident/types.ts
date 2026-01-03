export interface IncidentSkillConfig {
  pagerduty?: {
    apiKey?: string
    serviceId?: string
    escalationPolicyId?: string
  }
  slack?: {
    botToken?: string
    channelId?: string
  }
}

export type IncidentCommand = "start" | "update" | "resolve" | "postmortem" | "oncall"

export type IncidentSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4"

export interface IncidentStartOptions {
  title: string
  severity: IncidentSeverity
  service?: string
  description?: string
  assignee?: string
}

export interface IncidentUpdateOptions {
  incidentId: string
  status?: "investigating" | "identified" | "monitoring" | "resolved"
  message: string
  notify?: boolean
}

export interface IncidentResolveOptions {
  incidentId: string
  resolution: string
  rootCause?: string
}

export interface IncidentPostmortemOptions {
  incidentId: string
  template?: "basic" | "detailed" | "blameless"
}

export interface OnCallOptions {
  schedule?: string
  time?: string
}
