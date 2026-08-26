@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Gera chaves de cifragem e token de verificacao da Meta.
rem Uso: gera-chave-cifra.bat [--env C:\caminho\.env.local] [--redis-url URL]

set "_ENV_FILE=%~dp0..\.env.local"
set "_REDIS_URL="

:args
if "%~1"=="" goto run
if /I "%~1"=="--env" (
  if "%~2"=="" (
    echo [ERRO] --env exige um caminho.
    exit /b 2
  )
  set "_ENV_FILE=%~2"
  shift
  shift
  goto args
)
if /I "%~1"=="--redis-url" (
  if "%~2"=="" (
    echo [ERRO] --redis-url exige uma URL.
    exit /b 2
  )
  set "_REDIS_URL=%~2"
  shift
  shift
  goto args
)
echo [ERRO] Opcao desconhecida: %~1
exit /b 2

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$path = [IO.Path]::GetFullPath($env:_ENV_FILE);" ^
  "$dir = Split-Path -Parent $path;" ^
  "if (-not (Test-Path -LiteralPath $dir -PathType Container)) { [IO.Directory]::CreateDirectory($dir) | Out-Null };" ^
  "function New-HexToken { $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); return (-join ($bytes | ForEach-Object { $_.ToString('x2') })) };" ^
  "$lines = if (Test-Path -LiteralPath $path -PathType Leaf) { @(Get-Content -LiteralPath $path) } else { @() };" ^
  "$values = @{ CPF_ENCRYPTION_KEY = ($lines | Where-Object { $_ -match '^CPF_ENCRYPTION_KEY\s*=' } | Select-Object -First 1) -replace '^CPF_ENCRYPTION_KEY\s*=\s*'; NUVEMSHOP_OAUTH_ENCRYPTION_KEY = ($lines | Where-Object { $_ -match '^NUVEMSHOP_OAUTH_ENCRYPTION_KEY\s*=' } | Select-Object -First 1) -replace '^NUVEMSHOP_OAUTH_ENCRYPTION_KEY\s*=\s*'; WAHA_BYO_ENCRYPTION_KEY = ($lines | Where-Object { $_ -match '^WAHA_BYO_ENCRYPTION_KEY\s*=' } | Select-Object -First 1) -replace '^WAHA_BYO_ENCRYPTION_KEY\s*=\s*'; UPSTASH_REDIS_REST_URL = ($lines | Where-Object { $_ -match '^UPSTASH_REDIS_REST_URL\s*=' } | Select-Object -First 1) -replace '^UPSTASH_REDIS_REST_URL\s*=\s*'; META_WEBHOOK_VERIFY_TOKEN = ($lines | Where-Object { $_ -match '^META_WEBHOOK_VERIFY_TOKEN\s*=' } | Select-Object -First 1) -replace '^META_WEBHOOK_VERIFY_TOKEN\s*=\s*' };" ^
  "if ([string]$values.NUVEMSHOP_OAUTH_ENCRYPTION_KEY -notmatch '^[0-9a-fA-F]{64}$') { $values.NUVEMSHOP_OAUTH_ENCRYPTION_KEY = New-HexToken };" ^
  "if ([string]::IsNullOrWhiteSpace([string]$values.CPF_ENCRYPTION_KEY) -or [string]$values.CPF_ENCRYPTION_KEY -notmatch '^[0-9a-fA-F]{64}$') { $values.CPF_ENCRYPTION_KEY = New-HexToken };" ^
  "if ([string]::IsNullOrWhiteSpace([string]$values.WAHA_BYO_ENCRYPTION_KEY) -or [string]$values.WAHA_BYO_ENCRYPTION_KEY -notmatch '^[0-9a-fA-F]{64}$') { $values.WAHA_BYO_ENCRYPTION_KEY = New-HexToken };" ^
  "if ($env:_REDIS_URL -match '^redis://') { throw 'UPSTASH_REDIS_REST_URL exige uma URL REST http(s), nao uma conexao redis://.' };" ^
  "if ($env:_REDIS_URL -match '^https?://') { $values.UPSTASH_REDIS_REST_URL = $env:_REDIS_URL } elseif ([string]$values.UPSTASH_REDIS_REST_URL -notmatch '^https?://') { $values.UPSTASH_REDIS_REST_URL = 'http://srh:80' };" ^
  "if ([string]$values.META_WEBHOOK_VERIFY_TOKEN -notmatch '^[0-9a-fA-F]{64}$') { $values.META_WEBHOOK_VERIFY_TOKEN = New-HexToken };" ^
  "foreach ($name in @('CPF_ENCRYPTION_KEY','NUVEMSHOP_OAUTH_ENCRYPTION_KEY','WAHA_BYO_ENCRYPTION_KEY','UPSTASH_REDIS_REST_URL','META_WEBHOOK_VERIFY_TOKEN')) { $line = $name + '=' + $values[$name]; $found = $false; $lines = @($lines | ForEach-Object { if ($_ -match ('^' + $name + '\s*=')) { $found = $true; $line } else { $_ } }); if (-not $found) { $lines += $line } };" ^
  "[IO.File]::WriteAllLines($path, $lines, (New-Object Text.UTF8Encoding($false)));" ^
  "Write-Host ('OK: chaves de cifragem e verificacao configuradas em ' + $path)"

if errorlevel 1 (
  echo [ERRO] Nao foi possivel gerar a chave.
  exit /b 1
)
exit /b 0
