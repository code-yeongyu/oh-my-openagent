import { resolve } from "node:path"

export async function writeDeliberationArtifact(workspaceRoot: string, id: string, content: string): Promise<void> {
  const sanitizedId = id.replace(/[^a-zA-Z0-9._-]/g, "_")
  await Bun.write(resolve(workspaceRoot, `.sisyphus/deliberations/${sanitizedId}.md`), content)
}
