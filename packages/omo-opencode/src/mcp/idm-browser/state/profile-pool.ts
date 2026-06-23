import { join } from "node:path"
import { mkdir, readdir, rm } from "node:fs/promises"
import { homedir } from "node:os"

const PROFILES_DIR = join(homedir(), "Library", "Caches", "idm", "browser", "profiles")

export type ProfileStatus = "available" | "in_use" | "burned"

export type ProfileEntry = {
  id: string
  dir: string
  status: ProfileStatus
  burnedAt?: number
}

export function createProfilePool(profilesDir = PROFILES_DIR) {
  const profiles = new Map<string, ProfileEntry>()

  async function ensureDir(): Promise<void> {
    await mkdir(profilesDir, { recursive: true })
  }

  async function acquire(): Promise<ProfileEntry> {
    await ensureDir()

    for (const [, entry] of profiles) {
      if (entry.status === "available") {
        entry.status = "in_use"
        return entry
      }
    }

    const id = `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const dir = join(profilesDir, id)
    await mkdir(dir, { recursive: true })

    const entry: ProfileEntry = { id, dir, status: "in_use" }
    profiles.set(id, entry)
    return entry
  }

  function release(id: string): void {
    const entry = profiles.get(id)
    if (entry && entry.status === "in_use") {
      entry.status = "available"
    }
  }

  function burn(id: string): void {
    const entry = profiles.get(id)
    if (entry) {
      entry.status = "burned"
      entry.burnedAt = Date.now()
    }
  }

  async function cleanup(): Promise<number> {
    let cleaned = 0
    for (const [id, entry] of profiles) {
      if (entry.status === "burned") {
        await rm(entry.dir, { recursive: true, force: true })
        profiles.delete(id)
        cleaned++
      }
    }
    return cleaned
  }

  async function scan(): Promise<void> {
    await ensureDir()
    const dirs = await readdir(profilesDir)
    for (const name of dirs) {
      if (!profiles.has(name)) {
        profiles.set(name, {
          id: name,
          dir: join(profilesDir, name),
          status: "available",
        })
      }
    }
  }

  function getStats() {
    let available = 0, inUse = 0, burned = 0
    for (const [, entry] of profiles) {
      if (entry.status === "available") available++
      else if (entry.status === "in_use") inUse++
      else burned++
    }
    return { available, inUse, burned, total: profiles.size }
  }

  return { acquire, release, burn, cleanup, scan, getStats }
}

export type ProfilePool = ReturnType<typeof createProfilePool>
