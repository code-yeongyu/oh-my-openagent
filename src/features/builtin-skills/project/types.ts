export type ProjectSubcommand = "issue" | "sprint" | "board" | "doc" | "search"

export interface IssueInput {
  action: "create" | "update" | "transition" | "comment" | "link"
  project?: string
  issueKey?: string
  summary?: string
  description?: string
  type?: "bug" | "story" | "task" | "epic" | "subtask"
  priority?: "highest" | "high" | "medium" | "low" | "lowest"
  assignee?: string
  labels?: string[]
  status?: string
  comment?: string
  linkType?: string
  linkedIssue?: string
}

export interface IssueResult {
  key: string
  summary: string
  status: string
  assignee?: string
  priority: string
  type: string
  created: string
  updated: string
  url: string
}

export interface SprintInput {
  action: "list" | "create" | "start" | "complete" | "add-issues"
  boardId?: number
  sprintId?: number
  name?: string
  goal?: string
  startDate?: string
  endDate?: string
  issueKeys?: string[]
}

export interface SprintResult {
  id: number
  name: string
  state: "future" | "active" | "closed"
  goal?: string
  startDate?: string
  endDate?: string
  issues: SprintIssue[]
  metrics?: SprintMetrics
}

export interface SprintIssue {
  key: string
  summary: string
  status: string
  storyPoints?: number
  assignee?: string
}

export interface SprintMetrics {
  totalIssues: number
  completedIssues: number
  totalPoints: number
  completedPoints: number
  velocity?: number
}

export interface BoardInput {
  action: "list" | "get" | "backlog"
  boardId?: number
  projectKey?: string
  maxResults?: number
}

export interface BoardResult {
  id: number
  name: string
  type: "scrum" | "kanban"
  projectKey: string
  columns: BoardColumn[]
}

export interface BoardColumn {
  name: string
  status: string
  issueCount: number
}

export interface DocInput {
  action: "get" | "create" | "update" | "search"
  spaceKey?: string
  pageId?: string
  title?: string
  content?: string
  parentId?: string
  query?: string
}

export interface DocResult {
  id: string
  title: string
  spaceKey: string
  url: string
  version: number
  lastModified: string
  lastModifiedBy: string
  excerpt?: string
}

export interface SearchInput {
  query: string
  type?: "issue" | "doc" | "all"
  project?: string
  space?: string
  maxResults?: number
}

export interface SearchResult {
  type: "issue" | "doc"
  id: string
  title: string
  url: string
  excerpt?: string
  updated: string
}

export interface LinearIssueInput {
  action: "create" | "update" | "comment" | "archive"
  teamId?: string
  issueId?: string
  title?: string
  description?: string
  priority?: 0 | 1 | 2 | 3 | 4
  state?: string
  assigneeId?: string
  labels?: string[]
  projectId?: string
  cycleId?: string
  comment?: string
}

export interface LinearIssueResult {
  id: string
  identifier: string
  title: string
  state: string
  priority: number
  priorityLabel: string
  assignee?: string
  team: string
  project?: string
  cycle?: string
  url: string
  createdAt: string
  updatedAt: string
}

export interface LinearCycleInput {
  action: "list" | "get" | "create"
  teamId?: string
  cycleId?: string
  name?: string
  startsAt?: string
  endsAt?: string
}

export interface LinearCycleResult {
  id: string
  name: string
  number: number
  startsAt: string
  endsAt: string
  progress: number
  issueCount: number
  completedIssueCount: number
}

export interface LinearProjectInput {
  action: "list" | "get" | "create" | "update"
  projectId?: string
  name?: string
  description?: string
  teamIds?: string[]
  state?: "planned" | "started" | "paused" | "completed" | "canceled"
}

export interface LinearProjectResult {
  id: string
  name: string
  description?: string
  state: string
  progress: number
  teams: string[]
  issueCount: number
  completedIssueCount: number
  url: string
}

export interface ProjectConfig {
  atlassian?: {
    baseUrl?: string
    email?: string
  }
  linear?: {
    teamId?: string
  }
  defaultProject?: string
  defaultSpace?: string
}
