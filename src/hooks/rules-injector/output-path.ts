export interface ToolExecuteOutputShape {
  title: string;
  metadata: unknown;
}

export function getRuleInjectionFilePath(
  output: ToolExecuteOutputShape
): string | null {
  const metadata = output.metadata as Record<string, unknown> | null;
  const metadataFilePath =
    metadata && typeof metadata === "object" ? metadata.filePath : undefined;

  if (typeof metadataFilePath === "string" && metadataFilePath.length > 0) {
    return metadataFilePath;
  }

  if (typeof output.title === "string" && output.title.length > 0) {
    return output.title;
  }

  return null;
}
