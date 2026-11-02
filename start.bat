@echo off
set "PATH=C:\Users\USER\AppData\Local\Programs\NodeJS;C:\Users\USER\AppData\Local\Programs\MinGit\cmd;%PATH%"
cd /d "%~dp0"
echo ====================================================
echo  Starting Sonora Lossless Music Streaming Platform...
echo  Web Player will be open at http://localhost:3000
echo ====================================================
start http://localhost:3000
node server.js
pause
