import { Database } from "bun:sqlite"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync } from "node:fs"

const STATE_DIR = join(homedir(), "Library", "Caches", "idm", "browser")

export type StoredCookie = {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

export function createCookieJar(dbPath = join(STATE_DIR, "cookies.sqlite")) {
  mkdirSync(STATE_DIR, { recursive: true })

  const db = new Database(dbPath)
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
    CREATE TABLE IF NOT EXISTS cookies (
      profile_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '/',
      expires INTEGER NOT NULL DEFAULT 0,
      http_only INTEGER NOT NULL DEFAULT 0,
      secure INTEGER NOT NULL DEFAULT 0,
      same_site TEXT NOT NULL DEFAULT 'Lax',
      PRIMARY KEY (profile_id, domain, name, path)
    )
  `)

  function exportCookies(profileId: string): StoredCookie[] {
    return db.query<StoredCookie, [string]>(
      `SELECT name, value, domain, path, expires,
              http_only as httpOnly, secure, same_site as sameSite
       FROM cookies WHERE profile_id = ?1`
    ).all(profileId)
  }

  function importCookies(profileId: string, cookies: StoredCookie[]): void {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO cookies
       (profile_id, domain, name, value, path, expires, http_only, secure, same_site)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )

    const transaction = db.transaction(() => {
      for (const c of cookies) {
        stmt.run(
          profileId, c.domain, c.name, c.value, c.path,
          c.expires, c.httpOnly ? 1 : 0, c.secure ? 1 : 0, c.sameSite
        )
      }
    })

    transaction()
  }

  function clearProfile(profileId: string): void {
    db.run("DELETE FROM cookies WHERE profile_id = ?1", [profileId])
  }

  function close(): void {
    db.close()
  }

  return { exportCookies, importCookies, clearProfile, close }
}

export type CookieJar = ReturnType<typeof createCookieJar>
