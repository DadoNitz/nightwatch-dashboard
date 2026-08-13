@echo off
title PC Pulse
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Iniciar Painel.ps1"
if errorlevel 1 pause
