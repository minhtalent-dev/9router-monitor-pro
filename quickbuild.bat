@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo =======================================================
echo   9Router Monitor Pro - Quick Build and Auto Install
echo =======================================================
echo.

:: 1. Compile TypeScript and Webpack
echo [1/4] Compiling TypeScript and Webpack...
call npm run compile
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Compilation failed! Please check code errors.
    goto :FAIL
)
echo [OK] Compilation successful.
echo.

:: 2. Clean old VSIX files
echo [2/4] Cleaning old .vsix packages...
del /q *.vsix 2>nul
echo [OK] Cleaned.
echo.

:: 3. Package extension into VSIX
echo [3/4] Packaging extension into .vsix...
call npx @vscode/vsce package --no-dependencies
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Packaging failed!
    goto :FAIL
)

:: Find the newly generated VSIX file
set "VSIX_FILE="
for %%F in (*.vsix) do (
    set "VSIX_FILE=%%F"
)

if not defined VSIX_FILE (
    echo [ERROR] Could not find generated .vsix file!
    goto :FAIL
)
echo [OK] Packaged successfully: %VSIX_FILE%
echo.

:: 4. Auto install to VS Code
echo [4/4] Installing %VSIX_FILE% into VS Code...
where.exe code >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    call code --install-extension "%VSIX_FILE%" --force
    echo [OK] Installed into VS Code.
) else (
    echo [SKIP] 'code' command not found in PATH.
)

echo.
echo =======================================================
echo   [SUCCESS] Build and Install completed!
echo   VSIX: %CD%\%VSIX_FILE%
echo   Reload VS Code window: Ctrl+Shift+P -^> Reload Window
echo =======================================================
echo.
pause
exit /b 0

:FAIL
echo.
echo =======================================================
echo   [FAILED] Quick Build aborted due to errors.
echo =======================================================
echo.
pause
exit /b 1
