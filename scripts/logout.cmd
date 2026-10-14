@echo off
rem Signs this project out. Never touches your everyday Chrome.
rem Usage: logout.cmd [site]   clears the saved session and that site's cookies (default: flow.google.com)
rem        logout.cmd --all    also deletes the whole browser profile, which signs Google out completely
setlocal
set "HOME_DIR=%~dp0..\.api-anything"
if /i "%~1"=="--all" (
  call "%~dp0..\aa.cmd" logout flow.google.com
  if exist "%HOME_DIR%\profile" rmdir /s /q "%HOME_DIR%\profile"
  if exist "%HOME_DIR%\sessions" rmdir /s /q "%HOME_DIR%\sessions"
  echo Signed out completely: browser profile and saved sessions deleted.
  goto :eof
)
set "SITE=%~1"
if "%SITE%"=="" set "SITE=flow.google.com"
call "%~dp0..\aa.cmd" logout %SITE%
