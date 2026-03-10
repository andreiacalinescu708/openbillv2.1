@echo off
echo ==========================================
echo     OpenBill Server Starter
echo ==========================================
echo.
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
cls
echo Serverul porneste...
echo Apasa Ctrl+C pentru a opri serverul
echo.
node server.js
pause
