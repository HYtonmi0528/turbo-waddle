from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import auth, tasks, users, templates, data
from dependencies import get_current_user

app = FastAPI(title="LATIC询价协作系统", version="2.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(users.router)
app.include_router(templates.router)
app.include_router(data.router)

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

@app.get("/api/excel/generate")
async def excel_generate(templateId: str = ""):
    return {"detail": "请使用POST请求"}
@app.post("/api/excel/generate")
async def excel_generate_post(templateId: str = "", body: dict = None):
    return {"detail": "Excel生成需要模板文件"}  # Will implement with openpyxl

@app.get("/api/db/tables")
async def db_tables(user=Depends(get_current_user)):
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        result = await db.execute(text("SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA='latic_rfq' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"))
        return [{"name": r[0], "rowCount": r[1] or 0} for r in result.all()]

@app.get("/api/db/table/{name}")
async def db_table(name: str, page: int = 0, pageSize: int = 100):
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        cols = await db.execute(text(f"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME='{name}' ORDER BY ORDINAL_POSITION"))
        columns = [r[0] for r in cols.all()]
        total = await db.execute(text(f"SELECT COUNT(*) FROM `{name}`"))
        total_val = total.scalar()
        rows = await db.execute(text(f"SELECT * FROM `{name}` LIMIT {pageSize} OFFSET {page*pageSize}"))
        row_list = [dict(zip(columns, row)) for row in rows.all()]
        return {"columns": columns, "rows": row_list, "total": total_val}

@app.post("/api/db/query")
async def db_query(body: dict):
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        sql = (body.get("query","")).strip()
        if not sql.upper().startswith("SELECT"): raise HTTPException(400, "仅支持SELECT")
        result = await db.execute(text(sql))
        try:
            columns = list(result.keys())
            rows = [dict(zip(columns, row)) for row in result.all()]
            return {"columns": columns, "rows": rows, "total": len(rows)}
        except:
            return {"columns": [], "rows": [], "total": 0}

@app.post("/api/tasks/{id}/submit-review")
async def submit_review(id: str):
    return {"ok": True}
@app.post("/api/tasks/{id}/snapshots")
async def snapshots(id: str):
    return {"ok": True, "version": 1}
