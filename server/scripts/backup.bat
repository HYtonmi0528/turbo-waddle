@echo off
REM LATIC 自动备份脚本 - 配合 Windows 任务计划程序每日执行
REM 用法: 将此脚本添加到 Windows Task Scheduler，每日凌晨 2 点运行
SET BACKUP_DIR=%~dp0..\server-data\backups
SET MYSQL_USER=root
SET MYSQL_PASS=
SET MYSQL_DB=latic_rfq
SET MYSQL_HOST=127.0.0.1

IF NOT EXIST "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
SET FILE=%BACKUP_DIR%\latic_rfq_%date:~0,4%%date:~5,2%%date:~8,2%.sql
echo [%date% %time%] Backing up %MYSQL_DB% to %FILE%...
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe" -h%MYSQL_HOST% -u%MYSQL_USER% -p%MYSQL_PASS% --single-transaction --routines --triggers %MYSQL_DB% > "%FILE%" 2>&1
echo Done. Cleaning backups older than 30 days...
forfiles /p "%BACKUP_DIR%" /s /m *.sql /d -30 /c "cmd /c del @file" 2>nul
echo Backup complete.
