import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { CartographerDraft, InboxDraftFile } from "./types"
import { renderInboxZettel } from "./template-renderer"

export interface WriteInboxDraftDeps {
  vaultPath: string
  inboxSubdir?: string
  log?: (message: string, ...args: unknown[]) => void
}

export interface WriteInboxDraftInput {
  draft: CartographerDraft
  source_memory_ids: string[]
  origin: "auto-draft" | "manual-draft"
  created_at_iso?: string
}

const DEFAULT_INBOX_SUBDIR = "00_Inbox"

export async function writeInboxDraft(
  deps: WriteInboxDraftDeps,
  input: WriteInboxDraftInput,
): Promise<InboxDraftFile> {
  const inboxDir = join(deps.vaultPath, deps.inboxSubdir ?? DEFAULT_INBOX_SUBDIR)
  await mkdir(inboxDir, { recursive: true })

  const createdAt = input.created_at_iso ?? new Date().toISOString()
  const filename = buildFilename(createdAt, input.origin, input.draft.title)
  const fullPath = join(inboxDir, filename)
  const markdown = renderInboxZettel({
    draft: input.draft,
    source_memory_ids: input.source_memory_ids,
    origin: input.origin,
    created_at_iso: createdAt,
  })

  await writeFile(fullPath, markdown, "utf8")
  deps.log?.("[inbox-writer] draft written", { path: fullPath, origin: input.origin })

  return {
    filename,
    path: fullPath,
    markdown,
    memory_ids: input.source_memory_ids,
  }
}

export function buildFilename(
  createdAtIso: string,
  origin: "auto-draft" | "manual-draft",
  title: string,
): string {
  const timestamp = createdAtIso.replace("T", " ").slice(0, 16).replace(":", ".")
  const tag = origin === "auto-draft" ? "[auto]" : "[manual]"
  const slug = sanitizeTitle(title)
  return `${timestamp} - ${tag} ${slug}.md`
}

function sanitizeTitle(title: string): string {
  return title
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}
