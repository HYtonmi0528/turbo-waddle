@echo off
cd /d "%~dp0"
echo Starting LATIC RFQ Server...
node server\index.js
pause
