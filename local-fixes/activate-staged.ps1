# Replaces the live dist\index.js with the staged bundle (see stage-bundle.mjs).
# Run only with OpenChamber fully closed: OpenCode watches dist\index.js, and a swap under a
# running backend unloads every plugin ordered after this one (claude-code provider included).
#   pwsh -NoProfile -File local-fixes\activate-staged.ps1            # activate
#   pwsh -NoProfile -File local-fixes\activate-staged.ps1 -Rollback  # restore the newest backup
#   pwsh -NoProfile -File local-fixes\activate-staged.ps1 -Status    # report only
param([switch]$Rollback, [switch]$Status, [switch]$Force)
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$staged = Join-Path (Split-Path -Parent $root) ((Split-Path -Leaf $root) + '-staged')
$live = Join-Path $root 'dist\index.js'
$lanePath = Join-Path $staged 'lane.json'
$backups = Join-Path $staged 'backups'

function Get-Sha([string]$path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() }

if (-not (Test-Path -LiteralPath $lanePath)) { Write-Output "FAIL no staged bundle: run bun local-fixes\stage-bundle.mjs first"; exit 1 }
$lane = Get-Content -Raw -LiteralPath $lanePath | ConvertFrom-Json
$liveSha = Get-Sha $live
Write-Output "staged $($lane.stagedSha256.Substring(0,12)) (commit $($lane.commit.Substring(0,7)), built $($lane.builtUtc))"
Write-Output "live   $($liveSha.Substring(0,12))"

if ($Status) {
  if ($liveSha -eq $lane.stagedSha256) { Write-Output "ACTIVE on disk (a backend started before the swap still needs an OpenChamber restart)"; exit 0 }
  Write-Output "NOT ACTIVE"; exit 2
}

$running = @(Get-Process -Name 'OpenChamber', 'opencode' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $Force) {
  Write-Output "FAIL $($running.Count) OpenChamber/opencode process(es) are running. Quit OpenChamber fully (tray icon too), then run this again."
  exit 1
}

if ($Rollback) {
  $newest = Get-ChildItem -LiteralPath $backups -Filter 'index.js.*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $newest) { Write-Output "FAIL no backup to restore in $backups"; exit 1 }
  Copy-Item -LiteralPath $newest.FullName -Destination $live -Force
  Write-Output "PASS restored $($newest.Name) -> live $((Get-Sha $live).Substring(0,12))"
  exit 0
}

if ((Get-Sha $lane.staged) -ne $lane.stagedSha256) { Write-Output "FAIL staged bundle does not match lane.json: stage it again"; exit 1 }
if ($liveSha -eq $lane.stagedSha256) { Write-Output "PASS already active on disk"; exit 0 }

New-Item -ItemType Directory -Force -Path $backups | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backup = Join-Path $backups "index.js.$stamp"
Copy-Item -LiteralPath $live -Destination $backup
Add-Content -LiteralPath (Join-Path $backups 'MANIFEST.txt') -Value "$stamp  $liveSha  $backup"
Copy-Item -LiteralPath $lane.staged -Destination $live -Force
if ((Get-Sha $live) -ne $lane.stagedSha256) { Write-Output "FAIL live bundle differs after copy; restore $backup"; exit 1 }
Write-Output "PASS activated. Backup: $backup"
Write-Output "Start OpenChamber, then confirm with: bun run fixes:verify"
