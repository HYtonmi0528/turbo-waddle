param(
  [string]$Version = '8.4.10'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$earlyServerData = Join-Path $projectRoot 'server-data'
New-Item -ItemType Directory -Path $earlyServerData -Force | Out-Null
Start-Transcript -LiteralPath (Join-Path $earlyServerData 'install-mysql.log') -Append | Out-Null
$downloadDir = Join-Path $projectRoot '.downloads'
$archivePath = Join-Path $downloadDir "mysql-$Version-winx64.zip"
$downloadUrl = "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-$Version-winx64.zip"
$mysqlParent = 'C:\Program Files\MySQL'
$mysqlHome = 'C:\Program Files\MySQL\MySQL Server 8.4'
$expandedHome = Join-Path $mysqlParent "mysql-$Version-winx64"
$mysqlDataRoot = 'C:\ProgramData\LATIC-RFQ-MySQL'
$mysqlData = Join-Path $mysqlDataRoot 'Data'
$mysqlConfig = Join-Path $mysqlDataRoot 'my.ini'
$serviceName = 'LATICMySQL84'
$serverData = Join-Path $projectRoot 'server-data'
$serverFiles = Join-Path $serverData 'files'
$serverConfig = Join-Path $serverData 'config.json'
$sharedServerData = 'C:\ProgramData\LATIC-RFQ-Collaboration\server-data'
$sharedServerConfig = Join-Path $sharedServerData 'config.json'
$credentialsFile = Join-Path $serverData 'mysql-root-credentials.txt'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw '请以管理员身份运行此脚本。'
}

$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService -and $existingService.Status -eq 'Running' -and (Test-Path -LiteralPath $serverConfig)) {
  New-Item -ItemType Directory -Path $sharedServerData -Force | Out-Null
  Copy-Item -LiteralPath $serverConfig -Destination $sharedServerConfig -Force
  Write-Host 'MySQL服务和协作配置已经存在，无需重复安装。'
  Stop-Transcript | Out-Null
  exit 0
}

New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
  Write-Host "正在从Oracle官方CDN下载MySQL $Version LTS..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
}
if ((Get-Item -LiteralPath $archivePath).Length -lt 100MB) {
  throw '下载的MySQL压缩包大小异常，已停止安装。'
}

if (-not (Test-Path -LiteralPath $mysqlHome)) {
  New-Item -ItemType Directory -Path $mysqlParent -Force | Out-Null
  $resolvedParent = (Resolve-Path -LiteralPath $mysqlParent).Path
  if ($resolvedParent -ne $mysqlParent) {
    throw "MySQL目标目录校验失败：$resolvedParent"
  }
  Write-Host '正在解压MySQL...'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $mysqlParent
  if (-not (Test-Path -LiteralPath $expandedHome)) {
    throw "解压后未找到预期目录：$expandedHome"
  }
  Rename-Item -LiteralPath $expandedHome -NewName 'MySQL Server 8.4'
} else {
  Write-Host '检测到完整的MySQL程序目录，继续完成上次中断的安装。'
}

New-Item -ItemType Directory -Path $mysqlDataRoot -Force | Out-Null
New-Item -ItemType Directory -Path $serverFiles -Force | Out-Null
New-Item -ItemType Directory -Path $sharedServerData -Force | Out-Null
$configText = @"
[mysqld]
basedir=C:/Program Files/MySQL/MySQL Server 8.4
datadir=C:/ProgramData/LATIC-RFQ-MySQL/Data
port=3306
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-time-zone=+08:00
max_connections=100

[client]
port=3306
default-character-set=utf8mb4
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($mysqlConfig, $configText, $utf8NoBom)

$mysqld = Join-Path $mysqlHome 'bin\mysqld.exe'
$mysql = Join-Path $mysqlHome 'bin\mysql.exe'
if (-not (Test-Path -LiteralPath (Join-Path $mysqlData 'mysql'))) {
  & $mysqld "--defaults-file=$mysqlConfig" --initialize-insecure --console
  if ($LASTEXITCODE -ne 0) { throw "MySQL数据目录初始化失败，退出码：$LASTEXITCODE" }
} else {
  Write-Host '检测到已初始化的数据目录，保留并继续安装。'
}
if (-not $existingService) {
  & $mysqld "--defaults-file=$mysqlConfig" --install $serviceName
  if ($LASTEXITCODE -ne 0) { throw "MySQL Windows服务安装失败，退出码：$LASTEXITCODE" }
}
if ($existingService -and (Get-Service -Name $serviceName).Status -eq 'Running') {
  Restart-Service -Name $serviceName
} elseif ((Get-Service -Name $serviceName).Status -ne 'Running') {
  Start-Service -Name $serviceName
}

$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$rootBytes = New-Object byte[] 24
$appBytes = New-Object byte[] 24
$random.GetBytes($rootBytes)
$random.GetBytes($appBytes)
$random.Dispose()
$rootPassword = -join ($rootBytes | ForEach-Object { $_.ToString('x2') })
$appPassword = -join ($appBytes | ForEach-Object { $_.ToString('x2') })
$initialSql = @"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPassword';
CREATE DATABASE IF NOT EXISTS latic_rfq CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'latic_rfq_app'@'127.0.0.1' IDENTIFIED BY '$appPassword';
ALTER USER 'latic_rfq_app'@'127.0.0.1' IDENTIFIED BY '$appPassword';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON latic_rfq.* TO 'latic_rfq_app'@'127.0.0.1';
FLUSH PRIVILEGES;
"@
& $mysql -u root --skip-password --execute=$initialSql
if ($LASTEXITCODE -ne 0) { throw "MySQL账号初始化失败，退出码：$LASTEXITCODE" }

$env:LATIC_MYSQL_PASSWORD = $appPassword
$schema = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'server\schema.sql')
& $mysql --protocol=tcp -h 127.0.0.1 -u latic_rfq_app "--password=$env:LATIC_MYSQL_PASSWORD" latic_rfq --execute=$schema
$env:LATIC_MYSQL_PASSWORD = $null
if ($LASTEXITCODE -ne 0) { throw "协作数据库表结构初始化失败，退出码：$LASTEXITCODE" }

$serverConfigObject = @{
  server = @{ host = '0.0.0.0'; port = 3210 }
  mysql = @{ host = '127.0.0.1'; port = 3306; user = 'latic_rfq_app'; password = $appPassword; database = 'latic_rfq' }
  storageDir = $serverFiles
}
[IO.File]::WriteAllText($serverConfig, ($serverConfigObject | ConvertTo-Json -Depth 5), $utf8NoBom)
[IO.File]::WriteAllText($sharedServerConfig, ($serverConfigObject | ConvertTo-Json -Depth 5), $utf8NoBom)
[IO.File]::WriteAllText($credentialsFile, "MySQL root账号：root`r`nMySQL root密码：$rootPassword`r`n创建时间：$(Get-Date -Format s)`r`n请妥善保存，不要通过微信发送。", $utf8NoBom)

if (-not (Get-NetFirewallRule -DisplayName 'LATIC询价协作服务 TCP 3210' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'LATIC询价协作服务 TCP 3210' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3210 -Profile Domain,Private | Out-Null
}

Write-Host ''
Write-Host 'MySQL与协作环境安装完成。'
Write-Host "MySQL服务：$serviceName（仅监听127.0.0.1:3306）"
Write-Host "协作服务端口：3210（已允许局域网访问）"
Write-Host "服务器配置：$serverConfig"
Write-Host "root凭据：$credentialsFile"
Write-Host '重新启动本应用后，内置协作服务会自动启动。'
