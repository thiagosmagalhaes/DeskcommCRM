@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Lancador Windows do instalador self-host.
rem O instalador continua sendo install.sh porque depende de Bash e dos
rem utilitarios Unix usados pelo kit (curl, openssl, awk, sed e grep).

set "KIT_DIR=%~dp0"
set "INSTALL_SH=%KIT_DIR%install.sh"

if not exist "%INSTALL_SH%" (
  echo [ERRO] install.sh nao foi encontrado em "%KIT_DIR%".
  exit /b 1
)

if /I "%~1"=="--help" goto help
if /I "%~1"=="-h" goto help

rem Git Bash e a opcao recomendada no Windows: preserva os caminhos do kit.
set "GIT_BASH=%ProgramFiles%\Git\bin\bash.exe"
if exist "%GIT_BASH%" (
  "%GIT_BASH%" "%INSTALL_SH%" %*
  exit /b %ERRORLEVEL%
)

if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" (
  "%ProgramFiles(x86)%\Git\bin\bash.exe" "%INSTALL_SH%" %*
  exit /b %ERRORLEVEL%
)

where wsl.exe >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%P in ('powershell.exe -NoProfile -Command "$p=(Resolve-Path -LiteralPath '%INSTALL_SH%').Path; $p.Replace('\','/') -replace '^([A-Za-z]):','/$1'"') do set "WSL_SCRIPT=%%P"
  wsl.exe bash -lc "cd \"$(dirname \"$WSL_SCRIPT\")\" && bash \"$(basename \"$WSL_SCRIPT\")\" %*"
  exit /b %ERRORLEVEL%
)

echo [ERRO] Git Bash ou WSL nao foi encontrado.
echo        Instale o Git for Windows e execute este arquivo novamente.
echo        O instalador depende de Bash; o Docker Desktop sozinho nao substitui-lo.
exit /b 1

:help
echo Instala o sistema self-host neste servidor.
echo.
echo Uso:
echo   install.bat
 echo   install.bat --yes
 echo.
echo O instalador e executado por Git Bash ou WSL.
exit /b 0
