param(
  [string]$MysqlExe = "C:\xampp\mysql\bin\mysql.exe",
  [string]$SqlFile = "$PSScriptRoot\react-unifind\server\sql\xampp-unifind.sql",
  [string]$User = "root"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $MysqlExe)) {
  throw "MySQL client not found at $MysqlExe"
}

$resolvedSql = Resolve-Path $SqlFile
Get-Content $resolvedSql | & $MysqlExe -u $User
Write-Host "UniFind XAMPP database imported from $resolvedSql"
