@echo off
rem Sign in by hand, bound to this project's Chrome profile. Never touches your everyday Chrome.
rem Usage: login.cmd [url]   (default: https://flow.google.com/about)
rem
rem Step 1 opens plain Chrome (no automation) on the project profile. Google refuses sign-in in an
rem automated browser ("this browser may not be secure"), so the sign-in happens here. Sign in, open
rem Flow once, then close the window.
rem Step 2 has api-anything open the same profile briefly and save the session from it. No action needed.
setlocal
set "URL=%~1"
if "%URL%"=="" set "URL=https://flow.google.com/about"
set "PROFILE=%~dp0..\.api-anything\profile"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

echo [1/2] Sign in in the Chrome window, open Flow once, then close the window.
start "" /wait "%CHROME%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check "%URL%"

echo [2/2] Saving the session from the profile...
(ping -n 31 127.0.0.1 >nul & echo.) | call "%~dp0..\aa.cmd" login "%URL%" --window
