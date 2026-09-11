@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Anbar - Mobile Stack Manager
cd /d "%~dp0"

rem --- find / install Node.js ---
where node >nul 2>nul
if errorlevel 1 (
    echo [1/5] Node.js not found. Installing...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Automatic install is not possible here.
        echo Opening https://nodejs.org ... install Node.js, then run this file again.
        start "" "https://nodejs.org/en/download"
        pause
        exit /b 1
    )
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>nul
    if errorlevel 1 (
        echo Node.js install failed. Please try again.
        pause
        exit /b 1
    )
)

rem --- make sure npm is on PATH ---
where npm >nul 2>nul
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
    if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
    if exist "%LocalAppData%\Programs\nodejs\npm.cmd" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"
)

rem --- if the app is already running, just open the browser ---
node scripts\check-running.mjs
if not errorlevel 1 (
    title Anbar - Already Running
    echo.
    echo The app is already running on the local server.
    echo Opening the browser...
    start "" "http://localhost:5173/"
    echo.
    echo To close it, close any command window that runs it.
    pause
    exit /b 0
)

node scripts\start-app.mjs
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
    echo.
    echo Something went wrong. The details are shown above.
) else (
    echo.
    echo The app has stopped. You can close this window.
)
echo Press any key to close this window.
pause >nul