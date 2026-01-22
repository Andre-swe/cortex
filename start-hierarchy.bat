@echo off
set PATH=C:\Users\aubrey\AppData\Roaming\fnm\node-versions\v22.22.0\installation;%PATH%
cd /d C:\Users\aubrey\OneDrive\Desktop\mindcraftrealis\mindcraft-develop
echo Using Node version:
node --version
echo.
echo Starting Mindcraft Hierarchy Mode...
node main.js --hierarchy --leaders 3 --workers 0
pause
