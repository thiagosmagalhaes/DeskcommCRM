@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem ==========================================================================
rem marca-emails.bat
rem Versao Windows do marca-emails.sh.
rem Auto-contido: extrai o bloco PowerShell abaixo para %%TEMP%% e o executa.
rem Nao exige Bash, awk, jq ou Python. Requer Windows PowerShell 5.1+ e acesso
rem de rede ao Supabase Management API quando nao estiver em --render-em.
rem ==========================================================================

set "_MARCA_BAT_SELF=%~f0"
set "_MARCA_BAT_DIR=%~dp0"
set "_MARCA_PS1=%TEMP%\marca-emails-%RANDOM%-%RANDOM%.ps1"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [AVISO] PowerShell nao foi encontrado. Nao foi possivel executar marca-emails.bat.
  exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$lines = Get-Content -LiteralPath $env:_MARCA_BAT_SELF -Encoding UTF8;" ^
  "$idx = [Array]::IndexOf($lines, '#==POWERSHELL==');" ^
  "if ($idx -lt 0) { exit 2 };" ^
  "$payload = $lines[($idx + 1)..($lines.Length - 1)];" ^
  "[IO.File]::WriteAllLines($env:_MARCA_PS1, $payload, (New-Object Text.UTF8Encoding($true)))"

if errorlevel 1 (
  echo [AVISO] Nao foi possivel preparar o script PowerShell interno.
  del /q "%_MARCA_PS1%" >nul 2>nul
  exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%_MARCA_PS1%" %*
set "_MARCA_RC=%ERRORLEVEL%"

del /q "%_MARCA_PS1%" >nul 2>nul
exit /b %_MARCA_RC%

#==POWERSHELL==
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Write-Yellow([string]$Text) { Write-Host $Text -ForegroundColor Yellow }
function Write-Green([string]$Text)  { Write-Host $Text -ForegroundColor Green }
function Write-Dim([string]$Text)    { Write-Host $Text -ForegroundColor DarkGray }
function Write-Step([string]$Text)   { Write-Host "`n==> $Text" -ForegroundColor Cyan }

function Show-Help {
    Write-Host 'Sobe os e-mails de ACESSO (criar conta e recuperar senha) com a marca da'
    Write-Host 'instalacao e configura Site URL / Redirect URLs no Supabase.'
    Write-Host ''
    Write-Host 'Uso:'
    Write-Host '  marca-emails.bat'
    Write-Host '  marca-emails.bat --render-em C:\temp\emails'
    Write-Host '  marca-emails.bat --env C:\projeto\.env'
    Write-Host '  marca-emails.bat --projeto C:\projeto'
}

$kitDir = [IO.Path]::GetFullPath($env:_MARCA_BAT_DIR)
$projDir = [IO.Path]::GetFullPath((Join-Path $kitDir '..'))
$apiBase = 'https://api.supabase.com/v1'
$envFile = ''
$renderEm = ''

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        '--render-em' {
            if ($i + 1 -lt $args.Count) { $renderEm = $args[++$i] }
        }
        '--env' {
            if ($i + 1 -lt $args.Count) { $envFile = $args[++$i] }
        }
        '--projeto' {
            if ($i + 1 -lt $args.Count) { $projDir = [IO.Path]::GetFullPath($args[++$i]) }
        }
        '-h' { Show-Help; exit 0 }
        '--help' { Show-Help; exit 0 }
        default {
            Write-Yellow "opcao desconhecida: $($args[$i])"
            exit 0
        }
    }
}

if ([string]::IsNullOrWhiteSpace($envFile)) {
    $envFile = Join-Path $projDir '.env'
} else {
    $envFile = [IO.Path]::GetFullPath($envFile)
}

function Load-DotEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }

    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $s = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($s) -or $s.StartsWith('#')) { continue }
        if ($s.StartsWith('export ')) { $s = $s.Substring(7).TrimStart() }

        $eq = $s.IndexOf('=')
        if ($eq -le 0) { continue }

        $name = $s.Substring(0, $eq).Trim()
        $value = $s.Substring($eq + 1).Trim()
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }

        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

Load-DotEnv $envFile

$appName = [Environment]::GetEnvironmentVariable('APP_NAME', 'Process')
if ([string]::IsNullOrWhiteSpace($appName)) { $appName = 'DeskcommCRM' }

$appUrl = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_APP_URL', 'Process')
if ($null -eq $appUrl) { $appUrl = '' }
$appUrl = $appUrl.Trim()

$accent = [Environment]::GetEnvironmentVariable('APP_ACCENT_HEX', 'Process')
if ($null -eq $accent -or $accent -notmatch '^#[0-9A-Fa-f]{6}$') { $accent = '#506d48' }

function Get-Foreground([string]$Hex) {
    $h = $Hex.TrimStart('#')
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    $y = (0.299 * $r + 0.587 * $g + 0.114 * $b) / 255
    if ($y -gt 0.6) { return '#171f15' }
    return '#ffffff'
}

$accentFg = Get-Foreground $accent
$marker = 'marca-emails ' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

function Escape-HtmlBrand([string]$Value) {
    if ($null -eq $Value) { return '' }
    return $Value.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}

function Remove-InternalHeader([string]$Content) {
    if ($null -eq $Content) { return '' }
    return [regex]::Replace($Content, '\A[ \t]*<!--[\s\S]*?-->\r?\n?', '', 1)
}

function Render-Template([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $content = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    $content = Remove-InternalHeader $content
    $content = $content.Replace('__APP_NAME__', (Escape-HtmlBrand $appName))
    $content = $content.Replace('__ACCENT_FG__', $accentFg)
    $content = $content.Replace('__ACCENT__', $accent)
    return "<!-- $marker -->`n$content"
}

function Manual-Instructions([string]$Reason) {
    Write-Host ''
    Write-Yellow "AVISO: $Reason"
    Write-Host ''
    Write-Dim '  Para fazer a mao, no painel do Supabase:'
    $manualUrl = if ([string]::IsNullOrWhiteSpace($appUrl)) { 'https://SEU_DOMINIO' } else { $appUrl.TrimEnd('/') }
    Write-Dim '    1. Authentication -> URL Configuration'
    Write-Dim "         Site URL:      $manualUrl"
    Write-Dim "         Redirect URLs: $manualUrl/auth/confirm"
    Write-Dim '    2. Authentication -> Email Templates -> Confirm signup / Reset password'
    Write-Dim '         <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}">Confirmar</a>'
    Write-Dim '         AVISO: o separador e &. Um ? aqui quebra o link.'
    Write-Host ''
    exit 0
}

$confirmationPath = Join-Path $projDir 'supabase\templates\confirmation.html'
$recoveryPath = Join-Path $projDir 'supabase\templates\recovery.html'

$htmlConfirm = Render-Template $confirmationPath
if ($null -eq $htmlConfirm) {
    Manual-Instructions 'nao achei supabase\templates\confirmation.html. Rode de dentro do repositorio ou use --projeto.'
}

$htmlRecovery = Render-Template $recoveryPath
if ($null -eq $htmlRecovery) {
    Manual-Instructions 'nao achei supabase\templates\recovery.html. Rode de dentro do repositorio ou use --projeto.'
}

if (-not [string]::IsNullOrWhiteSpace($renderEm)) {
    try {
        $renderEm = [IO.Path]::GetFullPath($renderEm)
        [IO.Directory]::CreateDirectory($renderEm) | Out-Null
        $utf8NoBom = New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText((Join-Path $renderEm 'confirmation.html'), $htmlConfirm + "`n", $utf8NoBom)
        [IO.File]::WriteAllText((Join-Path $renderEm 'recovery.html'), $htmlRecovery + "`n", $utf8NoBom)
        Write-Green "OK: modelos renderizados em $renderEm (marca: $appName, accent: $accent)"
        Write-Dim '  GoTrue self-hosted: aponte GOTRUE_MAILER_TEMPLATES_CONFIRMATION/RECOVERY para esses arquivos.'
        exit 0
    } catch {
        Manual-Instructions "nao consegui escrever em ${renderEm}: $($_.Exception.Message)"
    }
}

$token = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'Process')
if ([string]::IsNullOrWhiteSpace($token)) {
    Manual-Instructions @"
sem SUPABASE_ACCESS_TOKEN - nao da para configurar os e-mails de acesso automaticamente.
    Pegue um token em https://supabase.com/dashboard/account/tokens e, no CMD, rode:
    set SUPABASE_ACCESS_TOKEN=sbp_...
    Depois chame este .bat novamente.
"@
}

$supabaseUrl = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_SUPABASE_URL', 'Process')
$ref = ''
if (-not [string]::IsNullOrWhiteSpace($supabaseUrl) -and $supabaseUrl -match '^https://([^.]+)\.supabase\.co(?:/|$)') {
    $ref = $Matches[1]
}

if ([string]::IsNullOrWhiteSpace($ref)) {
    $shown = if ([string]::IsNullOrWhiteSpace($supabaseUrl)) { 'vazio' } else { $supabaseUrl }
    Manual-Instructions @"
NEXT_PUBLIC_SUPABASE_URL nao e um projeto da nuvem do Supabase ($shown).
    Num Supabase proprio, use GOTRUE_MAILER_TEMPLATES_* apontando para os
    arquivos gerados por marca-emails.bat --render-em <dir>.
"@
}

function Invoke-ApiRaw([string]$Method, [string]$Path, [string]$Body = '') {
    $uri = $apiBase + $Path
    $headers = @{ Authorization = "Bearer $token" }
    try {
        $params = @{
            Uri = $uri
            Method = $Method
            Headers = $headers
            UseBasicParsing = $true
            ErrorAction = 'Stop'
        }
        if (-not [string]::IsNullOrEmpty($Body)) {
            $params['ContentType'] = 'application/json; charset=utf-8'
            $params['Body'] = [Text.Encoding]::UTF8.GetBytes($Body)
        }
        $response = Invoke-WebRequest @params
        return [string]$response.Content
    } catch {
        try {
            $resp = $_.Exception.Response
            if ($null -ne $resp) {
                $stream = $resp.GetResponseStream()
                if ($null -ne $stream) {
                    $reader = New-Object IO.StreamReader($stream)
                    $text = $reader.ReadToEnd()
                    $reader.Dispose()
                    if (-not [string]::IsNullOrWhiteSpace($text)) { return $text }
                }
            }
        } catch {}
        return (@{ message = $_.Exception.Message } | ConvertTo-Json -Compress)
    }
}

function Parse-Json([string]$Raw) {
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
    try { return $Raw | ConvertFrom-Json } catch { return $null }
}

function Get-Message([string]$Raw) {
    $obj = Parse-Json $Raw
    if ($null -ne $obj -and $null -ne $obj.message) { return [string]$obj.message }
    return ''
}

Write-Step "Configurando os e-mails de acesso (marca: $appName)"

$atualRaw = Invoke-ApiRaw 'GET' "/projects/$ref/config/auth"
$atual = Parse-Json $atualRaw
$readMessage = Get-Message $atualRaw
if (-not [string]::IsNullOrWhiteSpace($readMessage)) {
    Manual-Instructions "a API do Supabase recusou a leitura: $readMessage"
}
if ($null -eq $atual) {
    Manual-Instructions 'a resposta da API do Supabase nao era um JSON valido.'
}

$siteAtual = if ($null -eq $atual.site_url) { '' } else { [string]$atual.site_url }
if ($null -eq $atual.uri_allow_list) {
    $allowAtual = ''
} elseif ($atual.uri_allow_list -is [System.Array]) {
    $allowAtual = (($atual.uri_allow_list | ForEach-Object { [string]$_ }) -join ',')
} else {
    $allowAtual = [string]$atual.uri_allow_list
}

$siteNovo = $siteAtual
if (-not [string]::IsNullOrWhiteSpace($appUrl)) {
    if ([string]::IsNullOrWhiteSpace($siteAtual) -or
        $siteAtual -eq 'http://localhost:3000' -or
        $siteAtual -eq 'http://localhost:3000/') {
        $siteNovo = $appUrl
    } elseif ($siteAtual.TrimEnd('/') -ne $appUrl.TrimEnd('/')) {
        Write-Yellow "  Site URL ja esta em $siteAtual (deixei como esta; o app usa $appUrl)"
    }
}

$allowNovo = $allowAtual
if (-not [string]::IsNullOrWhiteSpace($appUrl)) {
    $baseUrl = $appUrl.TrimEnd('/')
    $entries = @()
    if (-not [string]::IsNullOrWhiteSpace($allowNovo)) {
        $entries = @($allowNovo.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    }

    foreach ($entry in @("$baseUrl/auth/confirm", "$baseUrl/**")) {
        if ($entries -notcontains $entry) { $entries += $entry }
    }
    $allowNovo = $entries -join ','
}

$payload = [ordered]@{
    mailer_subjects_confirmation = "Confirme seu e-mail — $appName"
    mailer_subjects_recovery = "Redefinir senha — $appName"
    mailer_templates_confirmation_content = $htmlConfirm
    mailer_templates_recovery_content = $htmlRecovery
    site_url = $siteNovo
    uri_allow_list = $allowNovo
}
$body = $payload | ConvertTo-Json -Compress -Depth 8

$respostaRaw = Invoke-ApiRaw 'PATCH' "/projects/$ref/config/auth" $body
$depoisRaw = Invoke-ApiRaw 'GET' "/projects/$ref/config/auth"

if (([string]$depoisRaw).Contains($marker)) {
    Write-Green 'OK: e-mails de acesso configurados e CONFERIDOS (reli o que gravei)'
    Write-Dim "    assunto:  Confirme seu e-mail — $appName"
    Write-Dim "    botao:    $accent sobre texto $accentFg"
    if ($siteNovo -ne $siteAtual) { Write-Dim "    site url: $siteNovo" }
    if ($allowNovo -ne $allowAtual) { Write-Dim "    redirect: $allowNovo" }
    exit 0
}

$reason = Get-Message $respostaRaw
if ([string]::IsNullOrWhiteSpace($reason)) { $reason = Get-Message $depoisRaw }
$suffix = if ([string]::IsNullOrWhiteSpace($reason)) { '' } else { " - $reason" }
Manual-Instructions @"
os e-mails de acesso NAO foram configurados$suffix.
    Reli a configuracao depois de gravar e o conteudo enviado nao estava la.
    A instalacao continua funcionando; so os e-mails ficam no modelo padrao.
"@
