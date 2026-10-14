@echo off
rem Usage: download.cmd <url> [target]   target: a file path or a folder; default is ..\downloads\
setlocal
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0download.mjs" %*
