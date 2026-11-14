param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = "Stop"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "the in-box C# compiler is missing at $csc" }
$sources = Get-ChildItem -Path $PSScriptRoot -Filter *.cs | ForEach-Object { $_.FullName }
& $csc /nologo /codepage:65001 /warnaserror+ /target:exe "/out:$Out" /r:System.Windows.Forms.dll /r:System.Drawing.dll @sources
if ($LASTEXITCODE -ne 0) { throw "csc exited $LASTEXITCODE" }
