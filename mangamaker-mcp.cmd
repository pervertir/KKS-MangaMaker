@echo off
rem KKS-MangaMaker MCP server for Windows. No arguments: stdio. --http serves Streamable HTTP on 127.0.0.1:8766/mcp.
rem Interpreter: %MANGAPIPE_PYTHON%, else python on PATH, else the py launcher. It needs PyYAML, Pillow and numpy
rem (the server says which are missing and how to install them). Setup for each client: docs\MCP.md
setlocal
set "HERE=%~dp0"
set "PYTHONUTF8=1"
if defined MANGAPIPE_PYTHON goto :custom
where python >nul 2>nul
if not errorlevel 1 goto :python
where py >nul 2>nul
if not errorlevel 1 goto :py
echo mangamaker-mcp: no Python found. Install Python 3.9+ and run: python -m pip install pyyaml pillow numpy requests 1>&2
echo   or set MANGAPIPE_PYTHON to the full path of python.exe (in the MCP client's "env" block) 1>&2
exit /b 127

:custom
"%MANGAPIPE_PYTHON%" "%HERE%mangamaker_mcp.py" %*
exit /b %ERRORLEVEL%

:python
python "%HERE%mangamaker_mcp.py" %*
exit /b %ERRORLEVEL%

:py
py -3 "%HERE%mangamaker_mcp.py" %*
exit /b %ERRORLEVEL%
