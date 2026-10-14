@echo off
rem Configure private QUEUE_SPEECH_* environment values before running.
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\Alnatheer Queue.exe" "%~dp0prepare-speech.js" %*
exit /b %errorlevel%
