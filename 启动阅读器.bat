@echo off
@chcp 65001 >nul 2>nul
title YouQian Reader
cd /d "%~dp0"

if exist "%~dp0node\node.exe" (
    set "PATH=%~dp0node;%PATH%"
)

taskkill /f /im electron.exe >nul 2>nul

call npm run dev

if %errorlevel% neq 0 (
    pause
)
