$path = "D:\repo\repostew\work-tmp\omoa\packages\omo-config-core\src\schema\config.ts"
$lines = Get-Content $path

# Drop the conflict markers only; the HEAD side already carries dev's schema.
# The ======= block is the pre-rebase PR body and must not be kept.
$out = New-Object System.Collections.Generic.List[string]
$state = "normal"
foreach ($line in $lines) {
  if ($line -match '^<<<<<<<') { $state = "ours"; continue }
  if ($line -match '^=======$') { if ($state -eq "ours") { $state = "theirs"; continue } }
  if ($line -match '^>>>>>>>') { if ($state -eq "theirs") { $state = "normal"; continue } }
  if ($state -eq "theirs") { continue }
  $out.Add($line)
}

$text = ($out -join "`n")

# PR intent 1: a profile name is any string with a non-whitespace character.
$text = $text.Replace(
  'export const OmoOpenCodeHarnessConfigSchema = z.record(z.string(), z.unknown())',
  "export const OmoOpenCodeHarnessConfigSchema = z.record(z.string(), z.unknown())`nconst OmoProfileNameSchema = z.string().regex(/\S/, `"Profile name must contain a non-whitespace character`")"
)

# PR intent 2: both schemas accept and validate the persisted selector.
$text = $text.Replace(
  "export const OmoConfigSchema = z`n  .object({`n    provenance:",
  "export const OmoConfigSchema = z`n  .object({`n    active_profile: OmoProfileNameSchema.optional(),`n    provenance:"
)
$text = $text.Replace(
  "export const OmoConfigLayerSchema = z`n  .object({`n    provenance:",
  "export const OmoConfigLayerSchema = z`n  .object({`n    active_profile: OmoProfileNameSchema.optional(),`n    provenance:"
)

# PR intent 3: profile map keys are validated names, not any string.
$text = $text.Replace(
  'profiles: z.record(z.string(), OmoConfigProfileSchema).default({}),',
  'profiles: z.record(OmoProfileNameSchema, OmoConfigProfileSchema).default({}),'
)
$text = $text.Replace(
  'profiles: z.record(z.string(), OmoConfigProfileSchema).optional(),',
  'profiles: z.record(OmoProfileNameSchema, OmoConfigProfileSchema).optional(),'
)

Set-Content -Path $path -Value $text -NoNewline
Write-Output "written"
