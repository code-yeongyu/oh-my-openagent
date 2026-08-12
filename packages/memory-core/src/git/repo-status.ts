import { DirtyRepoError } from "./errors"
import { describeDirtyMarkdownEncodingIssues, parsePorcelainPath } from "./porcelain"

export async function assertNoUnrelatedChanges(
  dir: string,
  paths: readonly string[],
  status: () => Promise<string>,
): Promise<void> {
  const porcelain = await status()
  const unrelated = porcelain.split(/\r?\n/).filter(Boolean).filter((line) => {
    const path = parsePorcelainPath(line)
    return path !== null && !paths.some((allowed) =>
      path === allowed || path.startsWith(`${allowed}/`) || allowed.startsWith(path.endsWith("/") ? path : `${path}/`),
    )
  })
  if (unrelated.length === 0) return
  const listing = `${unrelated.join("\n")}\n`
  throw new DirtyRepoError(listing, describeDirtyMarkdownEncodingIssues(dir, listing))
}
