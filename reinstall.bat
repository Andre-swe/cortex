@echo off
set PATH=C:\Users\aubrey\AppData\Roaming\fnm\node-versions\v22.22.0\installation;%PATH%
cd /d C:\Users\aubrey\OneDrive\Desktop\mindcraftrealis\mindcraft-develop
echo Using Node version:
node --version
echo.
echo Reinstalling dependencies...
rmdir /s /q node_modules 2>nul
call npm install --no-optional
echo Done!
pause
