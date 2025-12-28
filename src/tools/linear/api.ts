/**
 * Linear GraphQL API client
 * Direct API access without MCP dependency
 */

import { log } from "../../shared/logger"

const LINEAR_API_URL = "https://api.linear.app/graphql"

/**
 * Get Linear API key from environment
 */
function getApiKey(): string | null {
  return process.env.LINEAR_API_KEY || null
}

/**
 * Execute a GraphQL query against Linear API
 */
async function executeQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: T; error?: string }> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { error: "LINEAR_API_KEY environment variable not set" }
  }

  try {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      return { error: `Linear API error: ${response.status} ${response.statusText}` }
    }

    const result = (await response.json()) as {
      data?: T
      errors?: Array<{ message: string }>
    }

    if (result.errors && result.errors.length > 0) {
      return { error: result.errors.map((e) => e.message).join(", ") }
    }

    return { data: result.data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`[linear-api] Error:`, message)
    return { error: message }
  }
}

/**
 * Linear issue data structure
 */
export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description?: string
  branchName?: string
  url: string
  state: {
    id: string
    name: string
    type: string
  }
  parent?: {
    id: string
    identifier: string
  }
  labels: {
    nodes: Array<{ id: string; name: string }>
  }
}

/**
 * Get issue by ID or identifier
 */
export async function getIssue(
  issueId: string
): Promise<{ issue?: LinearIssue; error?: string }> {
  const query = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        branchName
        url
        state {
          id
          name
          type
        }
        parent {
          id
          identifier
        }
        labels {
          nodes {
            id
            name
          }
        }
      }
    }
  `

  const result = await executeQuery<{ issue: LinearIssue }>(query, { id: issueId })
  if (result.error) {
    return { error: result.error }
  }
  return { issue: result.data?.issue }
}

/**
 * Update issue state
 */
export async function updateIssueState(
  issueId: string,
  stateType: string
): Promise<{ success: boolean; error?: string }> {
  // First, get the issue to find its team
  const issueResult = await getIssue(issueId)
  if (issueResult.error || !issueResult.issue) {
    return { success: false, error: issueResult.error || "Issue not found" }
  }

  // Get workflow states for the team
  const statesQuery = `
    query GetIssueWithTeam($id: String!) {
      issue(id: $id) {
        team {
          id
          states {
            nodes {
              id
              name
              type
            }
          }
        }
      }
    }
  `

  const statesResult = await executeQuery<{
    issue: {
      team: {
        id: string
        states: {
          nodes: Array<{ id: string; name: string; type: string }>
        }
      }
    }
  }>(statesQuery, { id: issueId })

  if (statesResult.error || !statesResult.data?.issue?.team) {
    return { success: false, error: statesResult.error || "Could not get team states" }
  }

  // Find the state matching the type
  const states = statesResult.data.issue.team.states.nodes
  const targetState = states.find((s) => s.type.toLowerCase() === stateType.toLowerCase())

  if (!targetState) {
    return { success: false, error: `No state found with type: ${stateType}` }
  }

  // Update the issue
  const updateMutation = `
    mutation UpdateIssue($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue {
          id
          state {
            name
          }
        }
      }
    }
  `

  const updateResult = await executeQuery<{
    issueUpdate: { success: boolean }
  }>(updateMutation, { id: issueId, stateId: targetState.id })

  if (updateResult.error) {
    return { success: false, error: updateResult.error }
  }

  return { success: updateResult.data?.issueUpdate?.success ?? false }
}

/**
 * Create a comment on an issue
 */
export async function createComment(
  issueId: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  const mutation = `
    mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment {
          id
        }
      }
    }
  `

  const result = await executeQuery<{
    commentCreate: { success: boolean }
  }>(mutation, { issueId, body })

  if (result.error) {
    return { success: false, error: result.error }
  }

  return { success: result.data?.commentCreate?.success ?? false }
}

/**
 * Create a new issue
 */
export async function createIssue(args: {
  title: string
  description?: string
  teamId?: string
  teamName?: string
  labels?: string[]
  parentId?: string
}): Promise<{
  success: boolean
  issue?: { id: string; identifier: string; url: string; parent?: { id: string; identifier: string } }
  error?: string
}> {
  // If team name provided, find team ID
  let teamId = args.teamId
  if (!teamId && args.teamName) {
    const teamsQuery = `
      query GetTeams {
        teams {
          nodes {
            id
            name
            key
          }
        }
      }
    `
    const teamsResult = await executeQuery<{
      teams: { nodes: Array<{ id: string; name: string; key: string }> }
    }>(teamsQuery)

    if (teamsResult.error) {
      return { success: false, error: teamsResult.error }
    }

    const team = teamsResult.data?.teams?.nodes?.find(
      (t) =>
        t.name.toLowerCase() === args.teamName?.toLowerCase() ||
        t.key.toLowerCase() === args.teamName?.toLowerCase()
    )

    if (!team) {
      return { success: false, error: `Team not found: ${args.teamName}` }
    }
    teamId = team.id
  }

  if (!teamId) {
    return { success: false, error: "Team ID or name required" }
  }

  let resolvedParentId = args.parentId
  const isIdentifier = args.parentId && args.parentId.length < 36
  if (isIdentifier) {
    const parentResult = await getIssue(args.parentId!)
    if (parentResult.error || !parentResult.issue) {
      return { success: false, error: `Parent issue not found: ${args.parentId}` }
    }
    resolvedParentId = parentResult.issue.id
  }

  // Find label IDs if labels provided
  let labelIds: string[] = []
  if (args.labels && args.labels.length > 0) {
    const labelsQuery = `
      query GetLabels($teamId: String!) {
        team(id: $teamId) {
          labels {
            nodes {
              id
              name
            }
          }
        }
        issueLabels {
          nodes {
            id
            name
          }
        }
      }
    `
    const labelsResult = await executeQuery<{
      team: { labels: { nodes: Array<{ id: string; name: string }> } }
      issueLabels: { nodes: Array<{ id: string; name: string }> }
    }>(labelsQuery, { teamId })

    if (!labelsResult.error && labelsResult.data) {
      const allLabels = [
        ...(labelsResult.data.team?.labels?.nodes || []),
        ...(labelsResult.data.issueLabels?.nodes || []),
      ]
      labelIds = args.labels
        .map((name) => allLabels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id)
        .filter((id): id is string => !!id)
    }
  }

  // Create the issue
  const mutation = `
    mutation CreateIssue($title: String!, $description: String, $teamId: String!, $labelIds: [String!], $parentId: String) {
      issueCreate(input: { title: $title, description: $description, teamId: $teamId, labelIds: $labelIds, parentId: $parentId }) {
        success
        issue {
          id
          identifier
          url
          parent {
            id
            identifier
          }
        }
      }
    }
  `

  const result = await executeQuery<{
    issueCreate: {
      success: boolean
      issue: { id: string; identifier: string; url: string; parent?: { id: string; identifier: string } }
    }
  }>(mutation, {
    title: args.title,
    description: args.description,
    teamId,
    labelIds: labelIds.length > 0 ? labelIds : undefined,
    parentId: resolvedParentId,
  })

  if (result.error) {
    return { success: false, error: result.error }
  }

  if (!result.data?.issueCreate?.success) {
    return { success: false, error: "Failed to create issue" }
  }

  return {
    success: true,
    issue: result.data.issueCreate.issue,
  }
}

export async function archiveIssue(
  issueId: string
): Promise<{ success: boolean; error?: string }> {
  const mutation = `
    mutation ArchiveIssue($id: String!) {
      issueArchive(id: $id) {
        success
      }
    }
  `

  const result = await executeQuery<{
    issueArchive: { success: boolean }
  }>(mutation, { id: issueId })

  if (result.error) {
    return { success: false, error: result.error }
  }

  return { success: result.data?.issueArchive?.success ?? false }
}

export function isLinearAvailable(): boolean {
  return !!getApiKey()
}

/**
 * Extended issue type with team and full state for update operations
 */
export interface LinearIssueWithTeam extends LinearIssue {
  priority: number
  priorityLabel: string
  estimate?: number
  dueDate?: string
  assignee?: {
    id: string
    name: string
    email: string
  }
  team: {
    id: string
    labels: {
      nodes: Array<{ id: string; name: string }>
    }
  }
}

/**
 * Fetch issue with team context for label resolution and change tracking
 */
export async function getIssueWithTeam(
  issueId: string
): Promise<{ issue?: LinearIssueWithTeam; error?: string }> {
  const query = `
    query GetIssueWithTeam($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        branchName
        url
        priority
        priorityLabel
        estimate
        dueDate
        state {
          id
          name
          type
        }
        parent {
          id
          identifier
        }
        assignee {
          id
          name
          email
        }
        labels {
          nodes {
            id
            name
          }
        }
        team {
          id
          labels {
            nodes {
              id
              name
            }
          }
        }
      }
    }
  `

  const result = await executeQuery<{ issue: LinearIssueWithTeam }>(query, { id: issueId })
  if (result.error) {
    return { error: result.error }
  }
  return { issue: result.data?.issue }
}

/**
 * Resolve label names to UUIDs using team and workspace labels
 */
export async function resolveLabelNames(
  teamId: string,
  labelNames: string[]
): Promise<{ resolved: string[]; notFound: string[] }> {
  const labelsQuery = `
    query GetLabels($teamId: String!) {
      team(id: $teamId) {
        labels {
          nodes {
            id
            name
          }
        }
      }
      issueLabels {
        nodes {
          id
          name
        }
      }
    }
  `

  const result = await executeQuery<{
    team: { labels: { nodes: Array<{ id: string; name: string }> } }
    issueLabels: { nodes: Array<{ id: string; name: string }> }
  }>(labelsQuery, { teamId })

  if (result.error || !result.data) {
    return { resolved: [], notFound: labelNames }
  }

  const allLabels = [
    ...(result.data.team?.labels?.nodes || []),
    ...(result.data.issueLabels?.nodes || []),
  ]

  const resolved: string[] = []
  const notFound: string[] = []

  for (const name of labelNames) {
    const label = allLabels.find((l) => l.name.toLowerCase() === name.toLowerCase())
    if (label) {
      resolved.push(label.id)
    } else {
      notFound.push(name)
    }
  }

  return { resolved, notFound }
}

/**
 * Update issue fields via GraphQL mutation
 */
export async function updateIssue(args: {
  issueId: string
  title?: string
  description?: string
  priority?: number
  estimate?: number
  dueDate?: string | null
  assigneeId?: string | null
  labelIds?: string[]
  addedLabelIds?: string[]
  removedLabelIds?: string[]
}): Promise<{
  success: boolean
  issue?: LinearIssueWithTeam
  error?: string
}> {
  const mutation = `
    mutation UpdateIssue(
      $id: String!
      $title: String
      $description: String
      $priority: Int
      $estimate: Int
      $dueDate: TimelessDate
      $assigneeId: String
      $labelIds: [String!]
      $addedLabelIds: [String!]
      $removedLabelIds: [String!]
    ) {
      issueUpdate(
        id: $id
        input: {
          title: $title
          description: $description
          priority: $priority
          estimate: $estimate
          dueDate: $dueDate
          assigneeId: $assigneeId
          labelIds: $labelIds
          addedLabelIds: $addedLabelIds
          removedLabelIds: $removedLabelIds
        }
      ) {
        success
        issue {
          id
          identifier
          title
          description
          branchName
          url
          priority
          priorityLabel
          estimate
          dueDate
          state {
            id
            name
            type
          }
          parent {
            id
            identifier
          }
          assignee {
            id
            name
            email
          }
          labels {
            nodes {
              id
              name
            }
          }
          team {
            id
            labels {
              nodes {
                id
                name
              }
            }
          }
        }
      }
    }
  `

  const variables: Record<string, unknown> = { id: args.issueId }

  if (args.title !== undefined) variables.title = args.title
  if (args.description !== undefined) variables.description = args.description
  if (args.priority !== undefined) variables.priority = args.priority
  if (args.estimate !== undefined) variables.estimate = args.estimate
  if (args.dueDate !== undefined) variables.dueDate = args.dueDate
  if (args.assigneeId !== undefined) variables.assigneeId = args.assigneeId
  if (args.labelIds !== undefined) variables.labelIds = args.labelIds
  if (args.addedLabelIds !== undefined) variables.addedLabelIds = args.addedLabelIds
  if (args.removedLabelIds !== undefined) variables.removedLabelIds = args.removedLabelIds

  const result = await executeQuery<{
    issueUpdate: {
      success: boolean
      issue: LinearIssueWithTeam
    }
  }>(mutation, variables)

  if (result.error) {
    return { success: false, error: result.error }
  }

  if (!result.data?.issueUpdate?.success) {
    return { success: false, error: "Failed to update issue" }
  }

  return {
    success: true,
    issue: result.data.issueUpdate.issue,
  }
}
