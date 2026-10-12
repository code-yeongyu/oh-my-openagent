# Replaces the live dist\index.js with the staged bundle (see stage-bundle.mjs).
# Run only with OpenChamber fully closed: OpenCode watches dist\index.js, and a swap under a
# running backend unloads every plugin ordered after this one (claude-code provider included).
#   pwsh -NoProfile -File local-fixes\activate-staged.ps1            # activate
#   pwsh -NoProfile -File local-fixes\activate-staged.ps1 -Rollback  # restore the newest backup
#   pwsh -NoProfile -File local-fixes\activate-staged.ps1 -Status    # report only
#
# The staged bundle must belong to THIS checkout: lane.json has to name this checkout's staged
# and live paths, and the commit it was built from has to be the checked-out commit. A bundle
# whose source is not here would lose its fixes on the next rebuild without anyone noticing.
# -Root points the script at another checkout (rehearsals on copies).
param([switch]$Rollback, [switch]$Status, [switch]$Force, [string]$Root)
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$root = if ($Root) { (Resolve-Path -LiteralPath $Root).Path } else { Split-Path -Parent $PSScriptRoot }
$staged = Join-Path (Split-Path -Parent $root) ((Split-Path -Leaf $root) + '-staged')
$stagedBundle = Join-Path $staged 'dist\index.js'
$live = Join-Path $root 'dist\index.js'
$lanePath = Join-Path $staged 'lane.json'
$backups = Join-Path $staged 'backups'
$backupLog = Join-Path $backups 'MANIFEST.txt'

function Get-Sha([string]$path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() }
function Same-Path([string]$a, [string]$b) { $a -and $b -and ([IO.Path]::GetFullPath($a) -ieq [IO.Path]::GetFullPath($b)) }
function Get-NewestBackup {
  Get-ChildItem -LiteralPath $backups -Filter 'index.js.*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
}
function Get-RecordedSha([string]$name) {
  if (-not (Test-Path -LiteralPath $backupLog)) { return $null }
  $line = Get-Content -LiteralPath $backupLog | Where-Object { $_ -match [regex]::Escape($name) + '\s*$' } | Select-Object -Last 1
  if ($line -and $line -match '\b([0-9a-f]{64})\b') { return $Matches[1] }
  return $null
}

if (-not (Test-Path -LiteralPath $lanePath)) { Write-Output "FAIL no staged bundle: run bun local-fixes\stage-bundle.mjs first"; exit 1 }
$lane = Get-Content -Raw -LiteralPath $lanePath | ConvertFrom-Json
$liveSha = Get-Sha $live
Write-Output "staged $($lane.stagedSha256.Substring(0,12)) (commit $($lane.commit.Substring(0,7)), $($lane.fixes) fixes, built $($lane.builtUtc))"
Write-Output "live   $($liveSha.Substring(0,12))"

$problems = @()
if (-not (Same-Path $lane.staged $stagedBundle)) { $problems += "lane.json names another staged bundle ($($lane.staged)); expected $stagedBundle" }
if (-not (Same-Path $lane.live $live)) { $problems += "lane.json names another live bundle ($($lane.live)); expected $live" }
if (-not (Test-Path -LiteralPath $stagedBundle)) { $problems += "staged bundle missing: $stagedBundle" }
elseif ((Get-Sha $stagedBundle) -ne $lane.stagedSha256) { $problems += "staged bundle does not match lane.json: stage it again" }
$head = (& git -C $root rev-parse HEAD 2>$null | Out-String).Trim()
if (-not $head) { $problems += "cannot read the checked-out commit of $root" }
elseif ($head -ne $lane.commit) {
  $from = if ($lane.source) { $lane.source } else { '<the clone that staged it>' }
  $problems += "this checkout is at $($head.Substring(0,7)) but the staged bundle was built from $($lane.commit.Substring(0,7)). Bring the source here first (OpenChamber closed):  git -C `"$root`" fetch `"$from`" $($lane.branch)  then  git -C `"$root`" merge --ff-only $($lane.commit)"
}

if ($Status) {
  foreach ($problem in $problems) { Write-Output "PROVENANCE $problem" }
  if ($liveSha -eq $lane.stagedSha256) {
    if ($problems.Count -gt 0) { Write-Output "ACTIVE on disk, but the provenance above must be repaired"; exit 1 }
    Write-Output "ACTIVE on disk (a backend started before the swap still needs an OpenChamber restart)"; exit 0
  }
  Write-Output "NOT ACTIVE"; exit 2
}

$running = @(Get-Process -Name 'OpenChamber', 'opencode' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $Force) {
  Write-Output "FAIL $($running.Count) OpenChamber/opencode process(es) are running. Quit OpenChamber fully (tray icon too), then run this again."
  exit 1
}

if ($Rollback) {
  $newest = Get-NewestBackup
  if (-not $newest) { Write-Output "FAIL no backup to restore in $backups"; exit 1 }
  $recorded = Get-RecordedSha $newest.Name
  $backupSha = Get-Sha $newest.FullName
  if ($recorded -and $recorded -ne $backupSha) { Write-Output "FAIL $($newest.Name) is $($backupSha.Substring(0,12)) but was recorded as $($recorded.Substring(0,12)); not restoring a changed backup"; exit 1 }
  Copy-Item -LiteralPath $newest.FullName -Destination $live -Force
  if ((Get-Sha $live) -ne $backupSha) { Write-Output "FAIL live bundle differs from $($newest.Name) after copy"; exit 1 }
  Write-Output "PASS restored $($newest.Name) -> live $($backupSha.Substring(0,12))$(if (-not $recorded) { ' (no recorded hash to check it against)' })"
  Write-Output "The checkout stays at $($head.Substring(0,7)); the next bun run fixes:apply stages its bundle again."
  exit 0
}

if ($problems.Count -gt 0) { foreach ($problem in $problems) { Write-Output "FAIL $problem" }; exit 1 }
if ($liveSha -eq $lane.stagedSha256) { Write-Output "PASS already active on disk"; exit 0 }

New-Item -ItemType Directory -Force -Path $backups | Out-Null
$newest = Get-NewestBackup
if ($newest -and (Get-Sha $newest.FullName) -eq $liveSha) {
  $backup = $newest.FullName
  Write-Output "backup of the live bundle already present: $($newest.Name)"
} else {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  $backup = Join-Path $backups "index.js.$stamp"
  Copy-Item -LiteralPath $live -Destination $backup
  if ((Get-Sha $backup) -ne $liveSha) { Write-Output "FAIL backup differs from the live bundle; nothing was changed"; exit 1 }
  Add-Content -LiteralPath $backupLog -Value "$stamp  $liveSha  $backup"
}
Copy-Item -LiteralPath $stagedBundle -Destination $live -Force
if ((Get-Sha $live) -ne $lane.stagedSha256) { Write-Output "FAIL live bundle differs after copy; restore $backup"; exit 1 }
Write-Output "PASS activated. Backup: $backup"
Write-Output "Start OpenChamber, then confirm with: bun run fixes:verify"
