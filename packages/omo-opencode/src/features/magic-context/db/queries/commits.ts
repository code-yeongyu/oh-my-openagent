/**
 * CRUD for git_commits and git_commit_embeddings.
 *
 * Ported from MC's git-commits/storage-git-commits.ts and
 * git-commits/storage-git-commit-embeddings.ts.
 */

import type { Database } from "../sqlite"

// ── Git commit types ──────────────────────────────────────────

export interface GitCommit {
  sha: string
  shortSha: string
  message: string
  author: string | null
  committedAtMs: number
}

export interface StoredGitCommit extends GitCommit {
  projectPath: string
  indexedAtMs: number
}

// ── Upsert / Insert ───────────────────────────────────────────

export function upsertCommit(
  db: Database,
  projectPath: string,
  commit: GitCommit,
): void {
  db.prepare(
    `INSERT INTO git_commits (sha, project_path, short_sha, message, author, committed_at, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sha) DO UPDATE SET
       project_path = excluded.project_path,
       short_sha = excluded.short_sha,
       message = excluded.message,
       author = excluded.author,
       committed_at = excluded.committed_at,
       indexed_at = excluded.indexed_at
     WHERE git_commits.message != excluded.message`,
  ).run(
    commit.sha,
    projectPath,
    commit.shortSha,
    commit.message,
    commit.author,
    commit.committedAtMs,
    Date.now(),
  )
}

export function upsertCommits(
  db: Database,
  projectPath: string,
  commits: GitCommit[],
): { inserted: number; updated: number } {
  if (commits.length === 0) return { inserted: 0, updated: 0 }

  const existing = new Set<string>()
  for (const row of db
    .prepare("SELECT sha FROM git_commits WHERE project_path = ?")
    .all(projectPath) as { sha: string }[]) {
    existing.add(row.sha)
  }

  let inserted = 0
  let updated = 0
  const now = Date.now()

  db.transaction(() => {
    const stmt = db.prepare(
      `INSERT INTO git_commits (sha, project_path, short_sha, message, author, committed_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sha) DO UPDATE SET
         project_path = excluded.project_path,
         short_sha = excluded.short_sha,
         message = excluded.message,
         author = excluded.author,
         committed_at = excluded.committed_at,
         indexed_at = excluded.indexed_at
       WHERE git_commits.message != excluded.message`,
    )
    for (const commit of commits) {
      const result = stmt.run(
        commit.sha,
        projectPath,
        commit.shortSha,
        commit.message,
        commit.author,
        commit.committedAtMs,
        now,
      )
      if (result.changes > 0) {
        if (existing.has(commit.sha)) {
          updated++
        } else {
          inserted++
          existing.add(commit.sha)
        }
      }
    }
  })()

  return { inserted, updated }
}

// ── Get / List ────────────────────────────────────────────────

export function getCommitBySha(
  db: Database,
  sha: string,
): StoredGitCommit | null {
  const row = db
    .prepare("SELECT * FROM git_commits WHERE sha = ?")
    .get(sha) as {
    sha: string
    project_path: string
    short_sha: string
    message: string
    author: string | null
    committed_at: number
    indexed_at: number
  } | undefined
  if (!row) return null
  return {
    sha: row.sha,
    projectPath: row.project_path,
    shortSha: row.short_sha,
    message: row.message,
    author: row.author,
    committedAtMs: row.committed_at,
    indexedAtMs: row.indexed_at,
  }
}

export function getCommitCount(
  db: Database,
  projectPath: string,
): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM git_commits WHERE project_path = ?")
    .get(projectPath) as { count: number } | undefined
  return row?.count ?? 0
}

export function getLatestIndexedCommitTimeMs(
  db: Database,
  projectPath: string,
): number | null {
  const row = db
    .prepare(
      "SELECT MAX(committed_at) AS latest FROM git_commits WHERE project_path = ?",
    )
    .get(projectPath) as { latest: number | null } | undefined
  return row?.latest ?? null
}

// ── Eviction ──────────────────────────────────────────────────

export function evictOldestCommits(
  db: Database,
  projectPath: string,
  excess: number,
): number {
  if (excess <= 0) return 0
  const before = getCommitCount(db, projectPath)
  db.prepare(
    `DELETE FROM git_commits
     WHERE rowid IN (
       SELECT rowid FROM git_commits
       WHERE project_path = ?
       ORDER BY committed_at ASC, sha ASC
       LIMIT ?
     )`,
  ).run(projectPath, excess)
  return Math.max(0, before - getCommitCount(db, projectPath))
}

export function enforceCommitCap(
  db: Database,
  projectPath: string,
  maxCommits: number,
): number {
  if (maxCommits <= 0) return 0
  const count = getCommitCount(db, projectPath)
  if (count <= maxCommits) return 0
  db.prepare(
    `DELETE FROM git_commits
     WHERE rowid IN (
       SELECT rowid FROM git_commits
       WHERE project_path = ?
       ORDER BY committed_at DESC, sha DESC
       LIMIT -1 OFFSET ?
     )`,
  ).run(projectPath, maxCommits)
  return Math.max(0, count - getCommitCount(db, projectPath))
}

// ── Git commit embeddings ─────────────────────────────────────

export function saveCommitEmbedding(
  db: Database,
  sha: string,
  embedding: Float32Array,
  modelId: string,
): void {
  const bytes = new Uint8Array(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  )
  db.prepare(
    `INSERT INTO git_commit_embeddings (sha, embedding, model_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(sha, model_id) DO UPDATE SET
       embedding = excluded.embedding,
       created_at = excluded.created_at`,
  ).run(sha, bytes, modelId, Date.now())
}

export function loadProjectCommitEmbeddings(
  db: Database,
  projectPath: string,
  modelId: string,
): Map<string, Float32Array> {
  const rows = db
    .prepare(
      `SELECT e.sha, e.embedding
       FROM git_commit_embeddings e
       JOIN git_commits c ON c.sha = e.sha
       WHERE c.project_path = ? AND e.model_id = ?`,
    )
    .all(projectPath, modelId) as Array<{
    sha: string
    embedding: Uint8Array
  }>

  const map = new Map<string, Float32Array>()
  for (const row of rows) {
    const buffer = row.embedding.buffer.slice(
      row.embedding.byteOffset,
      row.embedding.byteOffset + row.embedding.byteLength,
    )
    map.set(row.sha, new Float32Array(buffer))
  }
  return map
}

export function loadUnembeddedCommits(
  db: Database,
  projectPath: string,
  modelId: string,
  limit: number,
): Array<{ sha: string; message: string }> {
  return db
    .prepare(
      `SELECT c.sha, c.message
       FROM git_commits c
       LEFT JOIN git_commit_embeddings e ON c.sha = e.sha AND e.model_id = ?
       WHERE c.project_path = ? AND e.sha IS NULL
       ORDER BY c.committed_at DESC
       LIMIT ?`,
    )
    .all(modelId, projectPath, limit) as Array<{
    sha: string
    message: string
  }>
}

export function clearProjectCommitEmbeddings(
  db: Database,
  projectPath: string,
  modelId?: string,
): number {
  if (modelId) {
    return db
      .prepare(
        `DELETE FROM git_commit_embeddings
         WHERE model_id = ? AND sha IN (SELECT sha FROM git_commits WHERE project_path = ?)`,
      )
      .run(modelId, projectPath).changes
  }
  return db
    .prepare(
      `DELETE FROM git_commit_embeddings
       WHERE sha IN (SELECT sha FROM git_commits WHERE project_path = ?)`,
    )
    .run(projectPath).changes
}
