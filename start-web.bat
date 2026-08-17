@echo off
setlocal
cd /d "%~dp0"
title LATIC 网页服务

if not exist "server-data\config.json" (
  echo 尚未找到 server-data\config.json
  echo 请先运行 npm run server:init 完成 MySQL 初始化。
  pause
  exit /b 1
)

start "LATIC Web Server" /min "%ComSpec%" /d /c "cd /d ""%~dp0"" && node server\index.js"
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:3210/"
echo 网页已打开。关闭服务请在任务管理器结束 node.exe，或关闭 LATIC Web Server 窗口。
endlocal
