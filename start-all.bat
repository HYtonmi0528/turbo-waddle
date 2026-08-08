@echo off
cd /d "%~dp0"
echo Starting LATIC v2 Backend (Python FastAPI)...
start "LATIC-Backend" python -m uvicorn main:app --host 0.0.0.0 --port 3210
cd /d "%~dp0..\frontend"
echo Starting LATIC v2 Frontend (Vue 3)...
start "LATIC-Frontend" npm run dev
echo.
echo Backend:  http://127.0.0.1:3210
echo Frontend: http://127.0.0.1:5173
echo API Docs: http://127.0.0.1:3210/docs
echo.
pause
