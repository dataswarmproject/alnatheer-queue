@echo off
rem Configure QUEUE_BRANCH_ID and QUEUE_DATA_DIR in this process environment first.
set ELECTRON_RUN_AS_NODE=1
if exist "%~dp0legacy-bootstrap.cjs" goto legacy
"%~dp0..\..\Alnatheer Queue.exe" "%~dp0main.js"
exit /b %errorlevel%
:legacy
"%~dp0..\..\Alnatheer Queue.exe" --require "%~dp0legacy-bootstrap.cjs" "%~dp0main.js"
exit /b %errorlevel%
