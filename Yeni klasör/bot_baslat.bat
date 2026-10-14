@echo off
chcp 65001 > nul
title Telegram Medya Takas Botu
echo ==============================================
echo       TELEGRAM MEDYA TAKAS BOTU BASLATILIYOR
echo ==============================================
echo.
cd /d "%~dp0"
node bot.js
pause
