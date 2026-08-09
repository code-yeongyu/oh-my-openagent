# Real-surface QA for lazycodex#6320.
#
# Drives the SHIPPED installer entrypoint and the SHIPPED uninstall CLI command against an
# isolated CODEX_HOME + CODEX_LOCAL_BIN_DIR, exercising the production environment path
# (no binDir argument is passed anywhere), and proves the developer's real ~/.codex and
# ~/.local/bin are untouched.
#
#   pwsh -File .omo/evidence/20260803-fix-6320-uninstall-bins/live-install-uninstall.ps1
#
# Exit 0 = PASS.

# Native tools (npm/bun) write progress and warnings to stderr; with ErrorActionPreference
# set to Stop those lines become terminating errors, so exit codes are checked explicitly.
$ErrorActionPreference = "Continue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location $repoRoot

$stamp = [guid]::NewGuid().ToString("N").Substring(0, 8)
$sandbox = Join-Path $env:TEMP "omo-6320-live-$stamp"
$codexHome = Join-Path $sandbox "codex"
$binDir = Join-Path $sandbox "bin"
New-Item -ItemType Directory -Force -Path $codexHome, $binDir | Out-Null

function Get-Sha256OrAbsent([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return "<absent>" }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
function Get-Listing([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return "<absent>" }
  return ((Get-ChildItem -LiteralPath $dir -Force | Select-Object -ExpandProperty Name | Sort-Object) -join ",")
}

$realCodexConfig = Join-Path $env:USERPROFILE ".codex\config.toml"
$realLocalBin = Join-Path $env:USERPROFILE ".local\bin"
$realConfigBefore = Get-Sha256OrAbsent $realCodexConfig
$realBinBefore = Get-Listing $realLocalBin

try {
  # Production environment contract: the installer and the uninstaller both read these.
  $env:CODEX_HOME = $codexHome
  $env:CODEX_LOCAL_BIN_DIR = $binDir

  Write-Output "=== ISOLATION ==="
  Write-Output "CODEX_HOME=<SANDBOX>\codex"
  Write-Output "CODEX_LOCAL_BIN_DIR=<SANDBOX>\bin"

  Write-Output ""
  Write-Output "=== REAL INSTALL: node packages/omo-codex/scripts/install-local.mjs ==="
  & node (Join-Path $repoRoot "packages\omo-codex\scripts\install-local.mjs") 2>&1 |
    Select-Object -Last 12 | ForEach-Object { "  $_" }
  $installExit = $LASTEXITCODE
  Write-Output "  install exit=$installExit"

  $afterInstall = Get-ChildItem -LiteralPath $binDir -Force -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name | Sort-Object
  Write-Output "  bin dir after install: $($afterInstall -join ', ')"

  # A user-owned lookalike that uninstall must preserve: a renamed copy of our own wrapper.
  $rootBin = Join-Path $binDir "omo.cmd"
  $userCopy = Join-Path $binDir "omo.backup"
  if (Test-Path -LiteralPath $rootBin) { Copy-Item -LiteralPath $rootBin -Destination $userCopy }

  # Prefer the uninstaller the installer just produced. On Windows that wrapper is currently
  # broken by a separate, already-reported defect (lazycodex#142: windowsNodeDiscoveryLines
  # emits an invalid CMD quote comparison, so cmd.exe aborts with "The syntax of the command
  # is incorrect." and exit 255; open sister-PR #5923). When that happens the run falls back
  # to the shipped bundle the wrapper itself execs, and records both, rather than silently
  # substituting the source CLI.
  $installedOmo = Join-Path $binDir "omo.cmd"
  Write-Output ""
  Write-Output "=== REAL UNINSTALL: the INSTALLED wrapper first ==="
  Write-Output "  installed wrapper present: $(Test-Path -LiteralPath $installedOmo)"
  $wrapperOut = & $installedOmo uninstall --platform=codex 2>&1
  $wrapperExit = $LASTEXITCODE
  Write-Output "  <BIN>\omo.cmd uninstall --platform=codex -> exit=$wrapperExit"
  $wrapperOut | Select-Object -Last 3 | ForEach-Object { "    $($_ -replace [regex]::Escape($sandbox), '<SANDBOX>')" }

  if ($wrapperExit -eq 0) {
    $uninstallOut = $wrapperOut
    $uninstallExit = 0
    Write-Output "  path used: installed wrapper"
  } else {
    Write-Output "  wrapper failed (known lazycodex#142 on Windows); falling back to the bundle it execs"
    Write-Output "=== REAL UNINSTALL: bun dist/cli/index.js uninstall --platform=codex (the SHIPPED bundle) ==="
    # The wrapper execs this bundle with bun; dist/cli is bun-targeted, and dist/cli-node is
    # the separate node fallback, so running it under node fails on __require.
    $uninstallOut = & bun (Join-Path $repoRoot "dist\cli\index.js") uninstall --platform=codex 2>&1
    $uninstallExit = $LASTEXITCODE
    Write-Output "  path used: shipped dist/cli bundle (bun, as the wrapper execs it)"
  }
  $uninstallOut | Select-Object -Last 25 | ForEach-Object { "  $($_ -replace [regex]::Escape($sandbox), '<SANDBOX>')" }
  Write-Output "  uninstall exit=$uninstallExit"

  $afterUninstall = @(Get-ChildItem -LiteralPath $binDir -Force -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name | Sort-Object)
  Write-Output "  bin dir after uninstall: $($afterUninstall -join ', ')"

  $realConfigAfter = Get-Sha256OrAbsent $realCodexConfig
  $realBinAfter = Get-Listing $realLocalBin

  $installedRoot = $afterInstall -contains "omo.cmd"
  $removedRoot = -not ($afterUninstall -contains "omo.cmd")
  $keptUserCopy = $afterUninstall -contains "omo.backup"
  $noManagedLeft = -not ($afterUninstall | Where-Object { $_ -match '^(omo|omo-.*|ulw|ulw-loop|lazycodex-executor-verify)\.cmd$' })
  $isolated = ($realConfigBefore -eq $realConfigAfter) -and ($realBinBefore -eq $realBinAfter)

  Write-Output ""
  Write-Output "=== ASSERTIONS ==="
  Write-Output "  installed root omo.cmd        : $installedRoot"
  Write-Output "  uninstall removed omo.cmd     : $removedRoot"
  Write-Output "  kept user copy omo.backup     : $keptUserCopy"
  Write-Output "  no managed bins left behind   : $noManagedLeft"
  Write-Output "  real ~/.codex/config.toml same: $($realConfigBefore -eq $realConfigAfter)"
  Write-Output "  real ~/.local/bin listing same: $($realBinBefore -eq $realBinAfter)"

  $pass = $installExit -eq 0 -and $uninstallExit -eq 0 -and $installedRoot -and $removedRoot -and
          $keptUserCopy -and $noManagedLeft -and $isolated
  Write-Output ""
  Write-Output "RESULT: $(if ($pass) { 'PASS' } else { 'FAIL' })"
  if (-not $pass) { exit 1 }
  exit 0
}
finally {
  Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
