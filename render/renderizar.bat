@echo off
rem Windows: doble clic para generar todas las imagenes del diorama en la carpeta salida\
rem (o arrastra blender.exe encima de este archivo si no lo encuentra solo)
cd /d "%~dp0"
set "B=%~1"
if "%B%"=="" for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender*") do set "B=%%D\blender.exe"
if not exist "%B%" (echo No encuentro Blender. Arrastra blender.exe encima de este archivo. & pause & exit /b 1)
"%B%" -b casa.blend -P renderizar.py
pause
