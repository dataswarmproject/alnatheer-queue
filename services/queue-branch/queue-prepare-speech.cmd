@echo off
rem Configure private QUEUE_SPEECH_* environment values before running.
set ELECTRON_RUN_AS_NODE=1
if exist "%~dp0legacy-bootstrap.cjs" goto legacy
"%~dp0..\..\Alnatheer Queue.exe" "%~dp0prepare-speech.js" %*
exit /b %errorlevel%
:legacy
"%~dp0..\..\Alnatheer Queue.exe" --require "%~dp0legacy-bootstrap.cjs" "%~dp0prepare-speech.js" %*
exit /b %errorlevel%
