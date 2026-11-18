@echo off
rem Builds the Strut Toolkit plugin into strut_toolkit\strut_toolkit.js.
rem   build.bat         lint, type check and tests first, then build (the release build)
rem   build.bat fast    build only, skipping the checks
rem Needs Node.js (see strut_toolkit\src\.nvmrc for the version). Run it from anywhere.
setlocal
cd /d "%~dp0strut_toolkit\src"

if not exist node_modules (
    echo Installing the packages...
    call npm install
    if errorlevel 1 goto :failed
)

if /i "%~1"=="fast" (
    echo Building without the checks...
    call npm run build:only
) else (
    echo Checking and building...
    call npm run build
)
if errorlevel 1 goto :failed

echo.
echo Done: %~dp0strut_toolkit\strut_toolkit.js
echo Next: bump "version" in strut_toolkit\src\package.json, add the notes to strut_toolkit\changelog.json,
echo       commit, then publish a GitHub release with a new tag.
exit /b 0

:failed
echo.
echo Build failed.
exit /b 1
