@echo off
setlocal
cd /d "%~dp0"
title LATIC 局域网询价协作系统

echo ========================================
echo   LATIC 局域网询价协作系统
echo ========================================
echo.
echo 正在启动服务端，请保持此窗口或服务窗口运行...

start "LATIC Server" /min "%ComSpec%" /d /c "cd /d ""%~dp0"" && node server\index.js"
timeout /t 4 /nobreak >nul

echo 正在打开桌面程序...
start "LATIC Desktop" /wait "%ComSpec%" /d /c "cd /d ""%~dp0"" && npm start"

echo.
echo 程序已关闭。服务端窗口仍可能在后台运行。
pause
endlocal
