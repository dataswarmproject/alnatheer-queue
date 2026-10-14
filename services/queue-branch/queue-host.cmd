@echo off
rem Configure QUEUE_BRANCH_ID and QUEUE_DATA_DIR in this process environment first.
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\Alnatheer Queue.exe" "%~dp0main.js"
