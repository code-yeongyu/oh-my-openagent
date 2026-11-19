@echo off
rem Windows hook dispatcher: runs a plugin-relative Node target with the Node that Codex resolves.
rem Usage: node-dispatch.cmd <plugin-relative target> [args...]
rem Hook arguments must be single tokens (no spaces, quotes or cmd metacharacters); bootstrap-hooks.test.mjs
rem enforces it. A quoted argument puts more than two quotes on the cmd /c line, so cmd strips the outer pair
rem and breaks it, and wrapping the line for cmd /s /c breaks hosts that run commandWindows through PowerShell.
rem cmd.exe starts in milliseconds; a Windows PowerShell hop cost about a second per hook and pushed
rem concurrent 5 s hooks past their timeout. Resolution order matches the former node-dispatch.ps1.
rem No labels or goto, so the file runs the same with LF or CRLF line endings.
setlocal DisableDelayedExpansion
set "OMO_TARGET="
set "OMO_ARGS="
for /f "tokens=1,*" %%A in ("%*") do (
  set "OMO_TARGET=%%~A"
  set "OMO_ARGS=%%B"
)
if not defined OMO_TARGET (
  echo LazyCodex hook dispatcher needs a plugin-relative target. 1>&2
  exit /b 2
)
for %%R in ("%~dp0..\..\..") do set "OMO_PLUGIN_ROOT=%%~fR"
if defined CODEX_HOME (set "OMO_CODEX_HOME=%CODEX_HOME%") else (set "OMO_CODEX_HOME=%USERPROFILE%\.codex")
set "OMO_NODE="
if defined NODE_REPL_NODE_PATH if exist "%NODE_REPL_NODE_PATH%" set "OMO_NODE=%NODE_REPL_NODE_PATH%"
if not defined OMO_NODE if exist "%OMO_CODEX_HOME%\config.toml" for /f "usebackq tokens=1,* delims== " %%A in (`findstr /r /c:"^[ 	]*NODE_REPL_NODE_PATH[ 	]*=" "%OMO_CODEX_HOME%\config.toml"`) do if not defined OMO_NODE if exist "%%~B" set "OMO_NODE=%%~B"
if not defined OMO_NODE if exist "%OMO_CODEX_HOME%\runtime\node" for /r "%OMO_CODEX_HOME%\runtime\node" %%F in (node.exe) do if not defined OMO_NODE if exist "%%F" set "OMO_NODE=%%F"
if not defined OMO_NODE if defined ProgramFiles if exist "%ProgramFiles%\nodejs\node.exe" set "OMO_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined OMO_NODE if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "OMO_NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined OMO_NODE for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined OMO_NODE set "OMO_NODE=%%N"
if not defined OMO_NODE (
  echo LazyCodex hook could not find Node. Rerun LazyCodex install from Codex Desktop or set NODE_REPL_NODE_PATH in Codex config. 1>&2
  exit /b 127
)
"%OMO_NODE%" "%OMO_PLUGIN_ROOT%\%OMO_TARGET%" %OMO_ARGS%
exit /b %ERRORLEVEL%
