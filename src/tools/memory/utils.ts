import { join, normalize } from "path"
import { DEFAULT_MEMORY_PATH, MEMORY_FILE_EXTENSION, ALLOWED_BASE_PATHS } from "./constants"
import { mkdir } from "node:fs/promises"

export function resolveMemoryPath(fileName: string, basePath: string = DEFAULT_MEMORY_PATH): string {
  let name = fileName.endsWith(MEMORY_FILE_EXTENSION) 
    ? fileName 
    : fileName + MEMORY_FILE_EXTENSION

  return normalize(join(process.cwd(), basePath, name))
}

export function validateFileName(fileName: string, basePath: string = DEFAULT_MEMORY_PATH): boolean {
  if (fileName.includes("..")) return false

  const targetPath = normalize(join(process.cwd(), basePath, fileName))
  const absoluteBasePath = normalize(join(process.cwd(), basePath))
  
  if (!targetPath.startsWith(absoluteBasePath)) return false

  const invalidChars = /[<>:"|?*]/
  if (invalidChars.test(fileName)) return false

  return true
}

export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = normalize(join(filePath, ".."))
  await mkdir(dir, { recursive: true })
}

export function validateBasePath(basePath: string): boolean {
  if (basePath.includes("..")) return false
  
  const normalizedPath = normalize(basePath).replace(/\\/g, "/")
  
  return ALLOWED_BASE_PATHS.some(allowed => 
    normalizedPath === allowed || 
    normalizedPath.startsWith(allowed) ||
    normalizedPath === allowed.slice(0, -1)
  )
}
