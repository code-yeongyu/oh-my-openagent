import { join } from "path"
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "fs"
import { getClaudeConfigDir } from "../../shared"
import type { TodoFile, TodoItem, ClaudeCodeTodoItem } from "./types"

const TODO_DIR = join(getClaudeConfigDir(), "todos")

export function getTodoPath(sessionId: string): string {
  return join(TODO_DIR, `${sessionId}-agent-${sessionId}.json`)
}

function ensureTodoDir(): void {
  if (!existsSync(TODO_DIR)) {
    mkdirSync(TODO_DIR, { recursive: true })
  }
}

export interface OpenCodeTodo {
  content: string
  status: string
  priority: string
  id: string
}

function toClaudeCodeFormat(item: OpenCodeTodo | TodoItem): ClaudeCodeTodoItem {
  return {
    content: item.content,
    status: item.status === "cancelled" ? "completed" : item.status,
    activeForm: item.content,
  }
}

export function loadTodoFile(sessionId: string): TodoFile | null {
   const path = getTodoPath(sessionId)
   if (!existsSync(path)) return null
   try {
     const content = JSON.parse(readFileSync(path, "utf-8"))
     if (Array.isArray(content)) {
       return {
         session_id: sessionId,
         items: content.map((item: ClaudeCodeTodoItem, idx: number) => ({
           id: String(idx),
           content: item.content,
           status: item.status as TodoItem["status"],
           created_at: new Date().toISOString(),
         })),
         created_at: new Date().toISOString(),
         updated_at: new Date().toISOString(),
       }
     }
     return content
   } catch {
     return null
   }
}

export function saveTodoFile(sessionId: string, file: TodoFile): void {
   ensureTodoDir()
   const path = getTodoPath(sessionId)
   const claudeCodeFormat: ClaudeCodeTodoItem[] = file.items.map(toClaudeCodeFormat)
   writeFileSync(path, JSON.stringify(claudeCodeFormat, null, 2))
}

export function saveOpenCodeTodos(sessionId: string, todos: OpenCodeTodo[]): void {
   ensureTodoDir()
   const path = getTodoPath(sessionId)
   const claudeCodeFormat: ClaudeCodeTodoItem[] = todos.map(toClaudeCodeFormat)
   writeFileSync(path, JSON.stringify(claudeCodeFormat, null, 2))
}

export function deleteTodoFile(sessionId: string): void {
   const path = getTodoPath(sessionId)
   if (existsSync(path)) {
     unlinkSync(path)
   }
}
