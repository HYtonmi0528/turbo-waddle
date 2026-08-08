from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from api import auth, tasks, users, templates, data
from dependencies import get_current_user
import os

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
async def excel_generate_post(body: dict, user=Depends(get_current_user)):
    import openpyxl, tempfile, io, os
    from fastapi.responses import StreamingResponse
    from database import AsyncSessionLocal
    from models import UserTemplate
    tid = body.get("templateId")
    if not tid: raise HTTPException(400, "请选择模板")
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        tpl = (await db.execute(select(UserTemplate).where(UserTemplate.id == tid))).scalar_one_or_none()
        if not tpl or not tpl.storage_path or not os.path.exists(tpl.storage_path):
            raise HTTPException(400, "模板文件不存在")
        wb = openpyxl.load_workbook(tpl.storage_path)
        ws = wb.active
        structure = tpl.structure_json or {}
        hr = structure.get("headerRow", 1) + 1
        batches = body.get("batches", [])
        row_num = hr
        for batch in batches:
            items = batch.get("items", [])
            for item in items:
                for col_idx, val in enumerate(item.values(), 1):
                    try: ws.cell(row=row_num, column=col_idx, value=val)
                    except: pass
                row_num += 1
        output = io.BytesIO()
        wb.save(output); output.seek(0)
        return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f"attachment;filename=generated.xlsx"})

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

@app.post("/api/tasks/{tid}/items/{iid}/attachments")
async def upload_attachment(tid: str, iid: str, file: UploadFile = File(...)):
    import shutil
    store = os.path.join(config.get("storageDir", "./server-data/files"), "tasks", tid, "attachments")
    os.makedirs(store, exist_ok=True)
    fpath = os.path.join(store, f"{__import__('uuid').uuid4()}-{file.filename}")
    with open(fpath, "wb") as f: shutil.copyfileobj(file.file, f)
    return {"ok": True, "name": file.filename, "size": os.path.getsize(fpath)}

@app.get("/api/tasks/{tid}/items/{iid}/attachments/{aid}")
async def get_attachment(tid: str, iid: str, aid: str):
    from fastapi.responses import FileResponse
    store = os.path.join(config.get("storageDir", "./server-data/files"), "tasks", tid, "attachments")
    if not os.path.exists(store): raise HTTPException(404)
    files = [f for f in os.listdir(store) if f.startswith(aid) or aid in f]
    if not files: raise HTTPException(404)
    return FileResponse(os.path.join(store, files[0]))

@app.post("/api/excel/open-existing")
async def excel_open_existing(file: UploadFile = File(...)):
    import openpyxl
    content = await file.read()
    wb = openpyxl.load_workbook(__import__('io').BytesIO(content), data_only=True)
    ws = wb.active
    batches = [{"category": "", "items": []}]
    for r in range(2, ws.max_row + 1):
        first = str(ws.cell(r, 1).value or "").strip()
        if not first and not ws.cell(r, 2).value: continue
        item = {}
        for c in range(1, ws.max_column + 1):
            item[f"col_{c}"] = ws.cell(r, c).value
        batches[0]["items"].append(item)
    return {"success": True, "batches": batches}
