export type ProjectRole = "READER" | "MEMBER" | "OWNER"

export interface Mem0Project {
  id: string
  name: string
  description?: string
  org_id: string
  created_at?: string
}

export interface Mem0ProjectConfig {
  name?: string
  description?: string
  custom_instructions?: string
  enable_graph?: boolean
  graph_threshold?: number
  multilingual?: boolean
  custom_categories?: string[]
}

export interface Mem0ProjectMember {
  user_id: string
  email?: string
  role: ProjectRole
}

export interface MultiTenancyClient {
  getProjects(org_id?: string): Promise<Mem0Project[]>
  createProject(config: Mem0ProjectConfig): Promise<Mem0Project>
  updateProject(project_id: string, config: Mem0ProjectConfig): Promise<void>
  deleteProject(project_id: string): Promise<void>
  getProject(project_id: string, fields?: string[]): Promise<Mem0Project & Record<string, unknown>>
  addProjectMember(project_id: string, email: string, role: ProjectRole): Promise<void>
  removeProjectMember(project_id: string, user_id: string): Promise<void>
  getProjectMembers(project_id: string): Promise<Mem0ProjectMember[]>
}

export const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, string[]> = {
  READER: ["view", "search"],
  MEMBER: ["view", "search", "create", "update", "delete"],
  OWNER: ["view", "search", "create", "update", "delete", "manage_members", "manage_settings"],
}

export function hasPermission(role: ProjectRole, permission: string): boolean {
  return PROJECT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function buildProjectScopedUserId(project_id: string, created_by: string): string {
  return `${project_id}:${created_by}`
}
