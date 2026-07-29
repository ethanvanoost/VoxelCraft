@echo off
rem Double-click this file to play VoxelCraft.
rem Starts a local server (required for ES modules) and opens the browser.
cd /d "%~dp0"
start "VoxelCraft Server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 /nobreak >nul
start http://localhost:8080/
