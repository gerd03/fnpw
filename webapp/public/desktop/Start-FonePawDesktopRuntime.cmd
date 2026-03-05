@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing 'https://raw.githubusercontent.com/gerd03/fnpw/main/webapp/public/desktop/Start-FonePawDesktopRuntime.ps1' | iex"
endlocal
