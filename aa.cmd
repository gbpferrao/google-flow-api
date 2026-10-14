@echo off
rem api-anything bounded to this folder: specs, sessions, captures and the browser profile live in .api-anything\
rem Full paths, so no other "node" or "api-anything" on PATH can answer instead.
setlocal
set "API_ANYTHING_HOME=%~dp0.api-anything"
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%APPDATA%\npm\node_modules\api-anything\dist\cli.js" %*
