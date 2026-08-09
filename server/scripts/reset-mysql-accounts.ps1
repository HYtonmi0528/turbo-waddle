$ErrorActionPreference = 'Stop'
$service = 'LATICMySQL84'
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe'
$mysqld = 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe'
$defaults = 'C:\ProgramData\LATIC-RFQ-MySQL\my.ini'
$root = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
$app = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
$out = Join-Path $env:TEMP 'latic-mysql-reset'
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host '正在停止 MySQL 服务（不会删除数据库文件）...'
sc.exe stop $service | Out-Null
Start-Sleep -Seconds 3
Get-Process mysqld -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$stdout = "$out\stdout.log"
$stderr = "$out\stderr.log"
$proc = Start-Process -FilePath $mysqld -ArgumentList @("--defaults-file=$defaults", '--skip-grant-tables', '--named-pipe', '--socket=LATICRecoveryPipe', '--console') -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
  Start-Sleep -Seconds 6
  $sql = @"
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY '$root';
CREATE USER IF NOT EXISTS 'latic_rfq_app'@'localhost' IDENTIFIED BY '$app';
ALTER USER 'latic_rfq_app'@'localhost' IDENTIFIED BY '$app';
CREATE USER IF NOT EXISTS 'latic_rfq_app'@'127.0.0.1' IDENTIFIED BY '$app';
ALTER USER 'latic_rfq_app'@'127.0.0.1' IDENTIFIED BY '$app';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON latic_rfq.* TO 'latic_rfq_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON latic_rfq.* TO 'latic_rfq_app'@'127.0.0.1';
FLUSH PRIVILEGES;
"@
  $sql | & $mysql --protocol=PIPE --socket=LATICRecoveryPipe -u root
  if ($LASTEXITCODE -ne 0) { throw "恢复模式登录失败，请查看 $stdout 和 $stderr" }
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Get-Process mysqld -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  sc.exe start $service | Out-Null
  Start-Sleep -Seconds 5
}

$configPath = Join-Path $PSScriptRoot '..\..\server-data\config.json'
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$config.mysql.password = $app
$json = $config | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))
$credentialPath = Join-Path (Split-Path $configPath) 'mysql-root-credentials.txt'
@("MySQL root account: root", "MySQL root password: $root", "Reset time: $(Get-Date -Format o)") | Set-Content $credentialPath -Encoding UTF8
Write-Host 'MySQL accounts reset completed. Existing database files were preserved. Run npm run server next.'
