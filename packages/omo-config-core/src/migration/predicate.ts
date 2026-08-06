export function hasMigrationMarker(target: Readonly<Record<string, unknown>>, migrationId: string): boolean {
  const markers = target["_migrations"]
  return Array.isArray(markers) && markers.some((marker) => marker === migrationId)
}

export function shouldRunMigration(input: {
  readonly legacySourcesExist: boolean
  readonly migrationId: string
  readonly target: Readonly<Record<string, unknown>>
}): boolean {
  return input.legacySourcesExist && !hasMigrationMarker(input.target, input.migrationId)
}
