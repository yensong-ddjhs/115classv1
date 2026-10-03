@echo off
cd /d "%~dp0"

echo ====================================================
echo   Classroom Binary Arena Server
echo ====================================================
echo.
echo Local URL: http://localhost:3000
echo Teacher:   http://localhost:3000/teacher.html
echo Student:   http://localhost:3000/student.html
echo.

node server.js
pause
