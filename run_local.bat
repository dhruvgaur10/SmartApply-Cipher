@echo off
setlocal

set "ROOT=%~dp0"

if not exist "%ROOT%backend\venv\Scripts\python.exe" (
    echo Backend venv not found at backend\venv. Run:
    echo   cd backend ^&^& python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist "%ROOT%backend\.env" (
    echo backend\.env not found. Copy backend\.env.example to backend\.env and fill in credentials.
    pause
    exit /b 1
)

if not exist "%ROOT%frontend\node_modules" (
    echo frontend\node_modules not found. Run:
    echo   cd frontend ^&^& npm install
    pause
    exit /b 1
)

echo Starting Job Dekho backend (FastAPI) on http://127.0.0.1:8000 ...
start "job-dekho-backend" cmd /k "cd /d "%ROOT%backend" && venv\Scripts\python -m uvicorn app.main:app --port 8000 --host 127.0.0.1 --reload"

echo Starting Job Dekho frontend (Next.js) on http://localhost:3000 ...
start "job-dekho-frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

echo.
echo Both services are starting in separate windows.
echo Backend:  http://127.0.0.1:8000/api/health
echo Frontend: http://localhost:3000
endlocal
