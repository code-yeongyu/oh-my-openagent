param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Sdk
)
$ErrorActionPreference = "Stop"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "the in-box C# compiler is missing at $csc" }
$lib = Join-Path $Sdk "lib\net462"
$native = Join-Path $Sdk "runtimes\win-x64\native\WebView2Loader.dll"
$dir = Split-Path -Parent $Out
New-Item -ItemType Directory -Force -Path (Join-Path $dir "web") | Out-Null
Copy-Item (Join-Path $lib "Microsoft.Web.WebView2.Core.dll"), (Join-Path $lib "Microsoft.Web.WebView2.WinForms.dll"), $native -Destination $dir
Copy-Item (Join-Path $PSScriptRoot "..\web\index.html"), (Join-Path $PSScriptRoot "..\web\page.js") -Destination (Join-Path $dir "web")
& $csc /nologo /codepage:65001 /warnaserror+ /platform:x64 /target:exe "/out:$Out" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll `
  "/r:$(Join-Path $dir 'Microsoft.Web.WebView2.Core.dll')" "/r:$(Join-Path $dir 'Microsoft.Web.WebView2.WinForms.dll')" `
  (Join-Path $PSScriptRoot "Program.cs")
if ($LASTEXITCODE -ne 0) { throw "csc exited $LASTEXITCODE" }
