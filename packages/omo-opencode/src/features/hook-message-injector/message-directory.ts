import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { MESSAGE_STORAGE } from "./constants"

function isInsideStorage(path: string): boolean {
  const relativePath = relative(resolve(MESSAGE_STORAGE), resolve(path))
  return relativePath === "" || (!/^\.\.(?:[\\/]|$)/.test(relativePath) && !isAbsolute(relativePath))
}

export function getOrCreateMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) {
    mkdirSync(MESSAGE_STORAGE, { recursive: true })
  }

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (!isInsideStorage(directPath)) {
    return null
  }

  if (existsSync(directPath)) {
    return directPath
  }

  try {
    for (const dir of readdirSync(MESSAGE_STORAGE)) {
      const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
      if (isInsideStorage(sessionPath) && existsSync(sessionPath)) {
        return sessionPath
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      mkdirSync(directPath, { recursive: true })
      return directPath
    }
    mkdirSync(directPath, { recursive: true })
    return directPath
  }

  mkdirSync(directPath, { recursive: true })
  return directPath
}
