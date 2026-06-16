@echo off
echo ===================================================
echo MAKE SURE XAMPP (MYSQL) IS RUNNING BEFORE CONTINUING!
echo ===================================================
pause
set "APP_DIR=%~dp0react-unifind"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
if not exist "%NPM_CMD%" set "NPM_CMD=npm"
start "UniFind Backend" cmd /k "cd /d \"%APP_DIR%\" && \"%NPM_CMD%\" run server"
start "UniFind Frontend" cmd /k "cd /d \"%APP_DIR%\" && \"%NPM_CMD%\" run dev"
