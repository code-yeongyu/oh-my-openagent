import { z } from "zod";
import { readFile, writeFile, rename, access } from "node:fs/promises";
import { 
  enhancedRecordingPaths, 
  validateLabelOrThrow 
} from "../../mcp/idm-browser/recording/recording-directory";

export class RecordingMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingMetadataError";
  }
}

export const RecordingMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  parameters: z.array(z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "secret"]),
    description: z.string()
  })),
  steps: z.number(),
  vision_checkpoint_count: z.number(),
  source_user_agent: z.string().optional(),
  source_locale: z.string().optional(),
  source_proxy_id: z.string().optional(),
  captcha_seen: z.boolean().optional()
});

export type RecordingMetadata = z.infer<typeof RecordingMetadataSchema>;

export async function readRecordingMetadata(name: string): Promise<RecordingMetadata> {
  const { metadataJson } = enhancedRecordingPaths(name);
  try {
    const content = await readFile(metadataJson, "utf-8");
    const data = JSON.parse(content);
    return RecordingMetadataSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingFields = error.issues.map(i => i.path.join(".")).join(", ");
      throw new RecordingMetadataError(`Invalid metadata for "${name}": missing or invalid fields: ${missingFields}`);
    }
    throw new RecordingMetadataError(`Failed to read metadata for "${name}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeRecordingMetadata(name: string, data: RecordingMetadata): Promise<void> {
  const { metadataJson } = enhancedRecordingPaths(name);
  const tempPath = `${metadataJson}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const content = JSON.stringify(data, null, 2);
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, metadataJson);
  } catch (error) {
    throw new RecordingMetadataError(`Failed to write metadata for "${name}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function renameRecording(oldName: string, newName: string): Promise<void> {
  validateLabelOrThrow(newName);
  const oldPaths = enhancedRecordingPaths(oldName);
  const newPaths = enhancedRecordingPaths(newName);

  if (await exists(newPaths.dir)) {
    throw new RecordingMetadataError(`Target recording "${newName}" already exists`);
  }

  try {
    await rename(oldPaths.dir, newPaths.dir);
    const metadata = await readRecordingMetadata(newName);
    metadata.name = newName;
    await writeRecordingMetadata(newName, metadata);
  } catch (error) {
    throw new RecordingMetadataError(`Failed to rename recording from "${oldName}" to "${newName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function bumpRecordingUsage(name: string): Promise<void> {
  const { metadataJson } = enhancedRecordingPaths(name);
  if (!(await exists(metadataJson))) return;

  const metadata = await readRecordingMetadata(name);
  metadata.lastUsedAt = new Date().toISOString();
  await writeRecordingMetadata(name, metadata);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
