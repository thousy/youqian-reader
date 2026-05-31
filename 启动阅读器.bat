@echo off
title InkWell Reader
cd /d "%~dp0"
set PATH=%~dp0node;%PATH%
set HTTPS_PROXY=http://127.0.0.1:1080
set HTTP_PROXY=http://127.0.0.1:1080
npm run dev
pause
