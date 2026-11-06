@echo off
setlocal EnableExtensions EnableDelayedExpansion

title CRMMS Web App

REM ============================================================
REM CRMMS Web App - Portable Windows Launcher
REM ============================================================
REM
REM This launcher:
REM
REM   1. Runs from the folder containing this BAT file
REM   2. Verifies required application files
REM   3. Automatically detects the frontend version
REM   4. Checks that app.js and styles.css versions agree
REM   5. Detects an old server already using port 8000
REM   6. Creates a local .venv if necessary
REM   7. Installs requirements when requirements.txt changes
REM   8. Tests the Python application import
REM   9. Starts a background browser/version checker
REM  10. Runs Uvicorn in the FOREGROUND
REM
REM CTRL+C stops the server.
REM
REM No frontend version needs to be maintained in this file.
REM ============================================================


REM ============================================================
REM APPLICATION LOCATION
REM ============================================================

cd /d "%~dp0"

set "APP_DIR=%CD%"
set "PORT=8000"

echo.
echo ============================================================
echo   CRMMS Web App
echo ============================================================
echo.
echo Application folder:
echo   %APP_DIR%
echo.


REM ============================================================
REM REQUIRED FILES
REM ============================================================

echo [CHECK] Checking application files...

for %%F in (
    "__init__.py"
    "main.py"
    "comparison.py"
    "rdf_reader.py"
    "requirements.txt"
    "static\index.html"
    "static\app.js"
    "static\styles.css"
    "static\plotly.min.js"
) do (

    if not exist "%%~F" (

        echo.
        echo ============================================================
        echo   REQUIRED FILE MISSING
        echo ============================================================
        echo.
        echo Could not find:
        echo.
        echo   %%~F
        echo.
        echo Application folder:
        echo.
        echo   %APP_DIR%
        echo.

        pause
        exit /b 1

    )

)

echo [OK] Required application files found.
echo.


REM ============================================================
REM AUTOMATIC FRONTEND VERSION DETECTION
REM ============================================================
REM
REM Reads versions directly from static\index.html.
REM
REM Expected HTML:
REM
REM   /static/styles.css?v=6.3.0
REM   /static/app.js?v=6.3.0
REM
REM The version can therefore change to 6.4.0, 7.0.0, etc.
REM without changing this BAT file.
REM ============================================================

set "FRONTEND_VERSION="
set "CSS_VERSION="


REM ------------------------------------------------------------
REM Read app.js version
REM ------------------------------------------------------------

for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command ^
    "$h = Get-Content -Raw 'static\index.html';" ^
    "$m = [regex]::Match($h, '/static/app\.js\?v=([0-9A-Za-z._-]+)');" ^
    "if ($m.Success) { Write-Output $m.Groups[1].Value }"`) do (

    set "FRONTEND_VERSION=%%V"

)


REM ------------------------------------------------------------
REM Read styles.css version
REM ------------------------------------------------------------

for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command ^
    "$h = Get-Content -Raw 'static\index.html';" ^
    "$m = [regex]::Match($h, '/static/styles\.css\?v=([0-9A-Za-z._-]+)');" ^
    "if ($m.Success) { Write-Output $m.Groups[1].Value }"`) do (

    set "CSS_VERSION=%%V"

)


REM ------------------------------------------------------------
REM Verify app.js version was found
REM ------------------------------------------------------------

if not defined FRONTEND_VERSION (

    echo.
    echo ============================================================
    echo   FRONTEND VERSION ERROR
    echo ============================================================
    echo.
    echo Could not determine the app.js version from:
    echo.
    echo   static\index.html
    echo.
    echo Expected a reference similar to:
    echo.
    echo   /static/app.js?v=6.3.0
    echo.

    pause
    exit /b 1

)


REM ------------------------------------------------------------
REM Verify styles.css version was found
REM ------------------------------------------------------------

if not defined CSS_VERSION (

    echo.
    echo ============================================================
    echo   FRONTEND VERSION ERROR
    echo ============================================================
    echo.
    echo Could not determine the styles.css version from:
    echo.
    echo   static\index.html
    echo.
    echo Expected a reference similar to:
    echo.
    echo   /static/styles.css?v=6.3.0
    echo.

    pause
    exit /b 1

)


REM ------------------------------------------------------------
REM Display versions
REM ------------------------------------------------------------

echo [CHECK] Frontend versions:
echo.
echo   app.js:     !FRONTEND_VERSION!
echo   styles.css: !CSS_VERSION!
echo.


echo [CHECK] Frontend asset references:
echo.

findstr /I "styles.css?v=" "static\index.html"
findstr /I "app.js?v=" "static\index.html"

echo.


REM ------------------------------------------------------------
REM JS and CSS versions must agree
REM ------------------------------------------------------------

if /I not "!CSS_VERSION!"=="!FRONTEND_VERSION!" (

    echo.
    echo ============================================================
    echo   FRONTEND VERSION MISMATCH
    echo ============================================================
    echo.
    echo app.js:
    echo   !FRONTEND_VERSION!
    echo.
    echo styles.css:
    echo   !CSS_VERSION!
    echo.
    echo Both references in static\index.html should use
    echo the same version.
    echo.

    pause
    exit /b 1

)


echo [OK] Frontend version !FRONTEND_VERSION! verified.
echo.


REM ============================================================
REM CHECK FOR EXISTING SERVER ON PORT 8000
REM ============================================================

echo [CHECK] Checking port %PORT%...

set "OLD_PID="


for /f "tokens=5" %%P in (
    'netstat -ano ^| findstr /R /C:"127.0.0.1:%PORT% .*LISTENING"'
) do (

    set "OLD_PID=%%P"

)


if defined OLD_PID (

    echo.
    echo ============================================================
    echo   EXISTING SERVER DETECTED
    echo ============================================================
    echo.
    echo Port %PORT% is already being used.
    echo.
    echo Process ID:
    echo.
    echo   !OLD_PID!
    echo.

    tasklist /FI "PID eq !OLD_PID!"

    echo.
    echo This may be an older CRMMS server.
    echo.
    echo Continuing without stopping it could cause the browser
    echo to display the wrong version of the application.
    echo.

    choice /C YN /M "Stop this process and start the current CRMMS app"


    if errorlevel 2 (

        echo.
        echo Startup cancelled.
        echo.

        pause
        exit /b 1

    )


    echo.
    echo [STOP] Terminating PID !OLD_PID!...


    taskkill /PID !OLD_PID! /F >nul 2>&1


    if errorlevel 1 (

        echo.
        echo ============================================================
        echo   COULD NOT STOP EXISTING SERVER
        echo ============================================================
        echo.
        echo Could not terminate PID:
        echo.
        echo   !OLD_PID!
        echo.
        echo Close the old CRMMS/Uvicorn command window manually
        echo and then run this launcher again.
        echo.

        pause
        exit /b 1

    )


    REM Give Windows time to release the port.

    timeout /t 2 /nobreak >nul

)


REM ------------------------------------------------------------
REM Verify port is actually free
REM ------------------------------------------------------------

set "PORT_BUSY="


for /f "tokens=5" %%P in (
    'netstat -ano ^| findstr /R /C:"127.0.0.1:%PORT% .*LISTENING"'
) do (

    set "PORT_BUSY=1"

)


if defined PORT_BUSY (

    echo.
    echo ============================================================
    echo   PORT STILL IN USE
    echo ============================================================
    echo.
    echo Port %PORT% is still occupied.
    echo.
    echo Close the process using the port and try again.
    echo.

    pause
    exit /b 1

)


echo [OK] Port %PORT% is available.
echo.


REM ============================================================
REM FIND PYTHON
REM ============================================================

set "PYTHON_CMD="


REM ------------------------------------------------------------
REM Prefer Windows Python launcher
REM ------------------------------------------------------------

where py >nul 2>&1

if not errorlevel 1 (

    py -3 --version >nul 2>&1

    if not errorlevel 1 (

        set "PYTHON_CMD=py -3"

    )

)


REM ------------------------------------------------------------
REM Fall back to python.exe on PATH
REM ------------------------------------------------------------

if not defined PYTHON_CMD (

    where python >nul 2>&1

    if not errorlevel 1 (

        python --version >nul 2>&1

        if not errorlevel 1 (

            set "PYTHON_CMD=python"

        )

    )

)


if not defined PYTHON_CMD (

    echo.
    echo ============================================================
    echo   PYTHON NOT FOUND
    echo ============================================================
    echo.
    echo Python 3 is required to run the CRMMS Web App.
    echo.
    echo Download Python from:
    echo.
    echo   https://www.python.org/downloads/
    echo.
    echo During installation, enable:
    echo.
    echo   Add Python to PATH
    echo.

    pause
    exit /b 1

)


echo [OK] Python found:

%PYTHON_CMD% --version

echo.


REM ============================================================
REM LOCAL VIRTUAL ENVIRONMENT
REM ============================================================
REM
REM The virtual environment lives inside the application folder:
REM
REM   .venv\
REM
REM When moving the application to another computer, you can
REM delete .venv first. This launcher recreates it automatically.
REM ============================================================

if not exist ".venv\Scripts\python.exe" (

    echo ============================================================
    echo   FIRST-TIME PYTHON SETUP
    echo ============================================================
    echo.
    echo [SETUP] Creating local virtual environment...
    echo.


    %PYTHON_CMD% -m venv ".venv"


    if errorlevel 1 (

        echo.
        echo ============================================================
        echo   VIRTUAL ENVIRONMENT ERROR
        echo ============================================================
        echo.
        echo Could not create:
        echo.
        echo   %APP_DIR%\.venv
        echo.

        pause
        exit /b 1

    )

)


set "VPY=%APP_DIR%\.venv\Scripts\python.exe"


echo [OK] Python environment:
echo.
echo   %VPY%
echo.


REM ============================================================
REM REQUIREMENTS
REM ============================================================
REM
REM requirements.txt is hashed.
REM
REM Packages are installed again only if requirements.txt
REM changes.
REM ============================================================

set "STAMP=.venv\requirements.stamp"

set "CURHASH="


for /f "tokens=1" %%H in (
    'certutil -hashfile requirements.txt SHA256 ^| findstr /r /v "hash CertUtil"'
) do (

    if not defined CURHASH (

        set "CURHASH=%%H"

    )

)


set "OLDHASH="


if exist "%STAMP%" (

    set /p OLDHASH=<"%STAMP%"

)


if /I not "!CURHASH!"=="!OLDHASH!" (

    echo.
    echo ============================================================
    echo   INSTALLING PYTHON REQUIREMENTS
    echo ============================================================
    echo.


    echo [SETUP] Updating pip...


    "%VPY%" -m pip install --upgrade pip


    if errorlevel 1 (

        echo.
        echo [ERROR] Could not update pip.
        echo.

        pause
        exit /b 1

    )


    echo.
    echo [SETUP] Installing requirements...
    echo.


    "%VPY%" -m pip install -r requirements.txt


    if errorlevel 1 (

        echo.
        echo ============================================================
        echo   REQUIREMENTS INSTALLATION FAILED
        echo ============================================================
        echo.

        pause
        exit /b 1

    )


    >"%STAMP%" echo !CURHASH!


) else (

    echo [OK] Requirements unchanged.

)


REM ------------------------------------------------------------
REM Dependency validation
REM ------------------------------------------------------------

echo.
echo [CHECK] Checking Python dependencies...


"%VPY%" -m pip check


if errorlevel 1 (

    echo.
    echo ============================================================
    echo   PYTHON DEPENDENCY ERROR
    echo ============================================================
    echo.

    pause
    exit /b 1

)


echo.


REM ============================================================
REM DETERMINE PYTHON PACKAGE NAME
REM ============================================================
REM
REM The application folder itself is a Python package.
REM
REM Examples:
REM
REM   app_v6
REM   CRMMS_Web_App
REM   CRMMS_Explorer_v6
REM
REM The folder may be moved anywhere.
REM ============================================================

for %%I in ("%APP_DIR%") do (

    set "PACKAGE_NAME=%%~nxI"

)


for %%I in ("%APP_DIR%\..") do (

    set "PACKAGE_PARENT=%%~fI"

)


echo [CHECK] Python package:
echo.
echo   !PACKAGE_NAME!
echo.

echo [CHECK] Python import root:
echo.
echo   !PACKAGE_PARENT!
echo.


REM ============================================================
REM VALIDATE PACKAGE NAME
REM ============================================================

"%VPY%" -c "import re,sys; name=r'!PACKAGE_NAME!'; sys.exit(0 if re.match(r'^[A-Za-z_][A-Za-z0-9_]*$',name) else 1)"


if errorlevel 1 (

    echo.
    echo ============================================================
    echo   INVALID APPLICATION FOLDER NAME
    echo ============================================================
    echo.
    echo Current folder:
    echo.
    echo   !PACKAGE_NAME!
    echo.
    echo The application folder must be a valid Python package
    echo name because main.py uses relative Python imports.
    echo.
    echo Good names:
    echo.
    echo   CRMMS_Web_App
    echo   CRMMS_Explorer_v6
    echo   app_v6
    echo.
    echo Avoid:
    echo.
    echo   CRMMS Web App
    echo   CRMMS-Web-App
    echo.

    pause
    exit /b 1

)


REM ============================================================
REM TEST APPLICATION IMPORT
REM ============================================================

echo [CHECK] Testing application import...


pushd "!PACKAGE_PARENT!"


"%VPY%" -c "import !PACKAGE_NAME!.main; print('[OK] Application imported successfully.')"


if errorlevel 1 (

    popd

    echo.
    echo ============================================================
    echo   APPLICATION IMPORT FAILED
    echo ============================================================
    echo.
    echo Python could not import:
    echo.
    echo   !PACKAGE_NAME!.main
    echo.

    pause
    exit /b 1

)


popd

echo.


REM ============================================================
REM BACKGROUND BROWSER / VERSION CHECKER
REM ============================================================
REM
REM Uvicorn will run in the foreground.
REM
REM This small PowerShell process runs in the background and:
REM
REM   1. Waits for localhost:8000
REM   2. Downloads /
REM   3. Confirms the server is serving the expected JS/CSS
REM   4. Opens the browser
REM
REM This prevents accidentally opening another/older CRMMS app.
REM ============================================================

echo [START] Browser will open after the server is verified.
echo.


start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "$base='http://127.0.0.1:%PORT%/';" ^
  "$expected='!FRONTEND_VERSION!';" ^
  "$ok=$false;" ^
  "for($i=0;$i -lt 60;$i++){" ^
  "  try{" ^
  "    $url=$base+'?startup='+[DateTime]::Now.Ticks;" ^
  "    $r=Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 1;" ^
  "    if($r.StatusCode -eq 200){" ^
  "      $h=$r.Content;" ^
  "      $js='/static/app.js?v='+$expected;" ^
  "      $css='/static/styles.css?v='+$expected;" ^
  "      if($h.Contains($js) -and $h.Contains($css)){" ^
  "        $ok=$true;" ^
  "        break;" ^
  "      }" ^
  "    }" ^
  "  }catch{};" ^
  "  Start-Sleep -Milliseconds 500;" ^
  "};" ^
  "if($ok){" ^
  "  Start-Process ($base+'?v='+$expected+'&startup='+[DateTime]::Now.Ticks);" ^
  "}"


REM ============================================================
REM START UVICORN IN FOREGROUND
REM ============================================================
REM
REM Do NOT use START /B for Uvicorn.
REM
REM Running it here means CTRL+C is delivered directly to
REM Uvicorn so FastAPI can shut down normally.
REM ============================================================

echo.
echo ============================================================
echo   CRMMS server starting
echo ============================================================
echo.
echo URL:
echo.
echo   http://127.0.0.1:%PORT%
echo.
echo Frontend version:
echo.
echo   !FRONTEND_VERSION!
echo.
echo Application:
echo.
echo   %APP_DIR%
echo.
echo Static files:
echo.
echo   %APP_DIR%\static
echo.
echo Python package:
echo.
echo   !PACKAGE_NAME!.main:app
echo.
echo ------------------------------------------------------------
echo   Press CTRL+C to stop the CRMMS server
echo ------------------------------------------------------------
echo.


pushd "!PACKAGE_PARENT!"


"%VPY%" -m uvicorn "!PACKAGE_NAME!.main:app" ^
    --host 127.0.0.1 ^
    --port %PORT%


set "RC=%errorlevel%"


popd


REM ============================================================
REM SHUTDOWN
REM ============================================================

echo.
echo ============================================================
echo   CRMMS server stopped
echo ============================================================
echo.
echo Exit code:
echo.
echo   %RC%
echo.


endlocal

exit /b %RC%