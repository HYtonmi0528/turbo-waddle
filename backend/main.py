from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import auth, tasks, users

app = FastAPI(title="LATIC询价协作系统", version="2.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(users.router)

@app.get("/api/health")
async def health():
    return {"ok": True, "service": "LATIC API v2", "time": __import__("datetime").datetime.utcnow().isoformat()}

@app.get("/api/setup/status")
async def setup_status():
    from database import AsyncSessionLocal
    from sqlalchemy import select, func
    from models import User
    async with AsyncSessionLocal() as db:
        count = await db.scalar(select(func.count()).select_from(User))
        return {"initialized": count > 0, "canInitialize": True}

@app.get("/api/exchange-rate")
async def exchange_rate():
    return {"rate": 7.25, "source": "默认"}

@app.get("/api/search")
async def search(q: str = ""):
    if len(q) < 2: return {"tasks": [], "items": []}
    from database import AsyncSessionLocal
    from models import RfqTask, RfqItem
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        tasks = await db.execute(select(RfqTask).where(RfqTask.title.like(f"%{q}%")).limit(20))
        return {"tasks": [{"id": t.id, "taskNo": t.task_no, "title": t.title, "status": t.status} for t in tasks.scalars()], "items": []}

@app.get("/api/notifications")
async def notifications():
    from database import AsyncSessionLocal
    from models import Notification
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Notification).limit(50))
        return {"notifications": []}

@app.on_event("startup")
async def startup():
    from database import engine, Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
