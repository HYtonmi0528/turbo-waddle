import json, uuid, datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import DataEntry, DataDraft, QuoteSet, QuoteItem
from dependencies import get_current_user
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["数据"])

class EntryReq(BaseModel):
    type: str = ""
    data: dict = {}

@router.get("/data/entries")
async def list_entries(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DataEntry).where(DataEntry.user_id == user.id).order_by(DataEntry.updated_at.desc()))
    entries = [{"id": e.id, "type": e.type, "data": e.data, "createdAt": e.created_at.isoformat() if e.created_at else None} for e in result.scalars().all()]
    return {"entries": entries}

@router.post("/data/entries")
async def save_entry(req: EntryReq, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    eid = str(uuid.uuid4())
    entry = DataEntry(id=eid, user_id=user.id, type=req.type, data=req.data or {})
    db.add(entry); await db.commit()
    return {"success": True, "id": eid}

@router.delete("/data/entries/{entry_id}")
async def del_entry(entry_id: str, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(DataEntry).where(DataEntry.id == entry_id, DataEntry.user_id == user.id))
    await db.commit()
    return {"ok": True}

@router.get("/drafts/{template_id}")
async def get_draft(template_id: str, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DataDraft).where(DataDraft.user_id == user.id, DataDraft.template_id == template_id))
    draft = result.scalar_one_or_none()
    return {"payload": draft.payload, "updatedAt": draft.updated_at.isoformat() if draft and draft.updated_at else None} if draft else None

@router.put("/drafts/{template_id}")
async def save_draft(template_id: str, payload: dict, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    eid = f"{user.id}:{template_id}"
    existing = (await db.execute(select(DataDraft).where(DataDraft.id == eid))).scalar_one_or_none()
    if existing:
        existing.payload = payload or {}
        existing.updated_at = datetime.datetime.utcnow()
    else:
        db.add(DataDraft(id=eid, user_id=user.id, template_id=template_id, payload=payload or {}))
    await db.commit()
    return {"success": True}

@router.delete("/drafts/{template_id}")
async def del_draft(template_id: str, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(DataDraft).where(DataDraft.user_id == user.id, DataDraft.template_id == template_id))
    await db.commit()
    return {"ok": True}

class QuoteReq(BaseModel):
    name: str = ""
    id: str = None
    projectId: str = None
    options: dict = {}
    fieldLabels: dict = {}
    batches: list = []

@router.get("/quotes")
async def list_quotes(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sets = (await db.execute(select(QuoteSet).where(QuoteSet.user_id == user.id).order_by(QuoteSet.updated_at.desc()))).scalars().all()
    result = []
    for qs in sets:
        items = (await db.execute(select(QuoteItem).where(QuoteItem.quote_set_id == qs.id).order_by(QuoteItem.item_index))).scalars().all()
        result.append({
            "id": qs.id, "name": qs.name, "projectId": qs.project_id,
            "options": qs.options_json or {}, "fieldLabels": qs.field_labels_json or {},
            "batches": [{"category": "全部", "items": [{
                "_quoteItemIndex": i.item_index, "supplierName": i.supplier_name,
                "model": i.model, "reference": i.reference, "description": i.description,
                "price": float(i.price) if i.price else None, "totalPrice": float(i.total_price) if i.total_price else None,
                "totalRmb": float(i.total_rmb) if i.total_rmb else None,
                "notes": i.notes, "afterSales": i.after_sales,
                "data": i.data_json or {}
            } for i in items]}]
        })
    return {"quoteSets": result}

@router.post("/quotes")
async def save_quote(req: QuoteReq, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not req.name: raise HTTPException(400, "名称不能为空")
    qid = req.id or str(uuid.uuid4())
    existing = (await db.execute(select(QuoteSet).where(QuoteSet.id == qid))).scalar_one_or_none()
    if existing:
        existing.name = req.name; existing.options_json = req.options; existing.field_labels_json = req.fieldLabels
        existing.updated_at = datetime.datetime.utcnow()
    else:
        db.add(QuoteSet(id=qid, user_id=user.id, name=req.name, options_json=req.options, field_labels_json=req.fieldLabels))
    await db.commit()
    # Delete old items and insert new
    await db.execute(delete(QuoteItem).where(QuoteItem.quote_set_id == qid))
    idx = 0
    for batch in (req.batches or []):
        for item in (batch.get("items") or []):
            qi = QuoteItem(id=str(uuid.uuid4()), quote_set_id=qid, item_index=idx,
                           supplier_name=item.get("supplierName"), model=item.get("model"),
                           reference=item.get("reference"), description=item.get("description"),
                           price=item.get("price"), total_price=item.get("totalPrice"),
                           total_rmb=item.get("totalRmb"), notes=item.get("notes"),
                           after_sales=item.get("afterSales"), data_json=item.get("data") or item)
            db.add(qi); idx += 1
    await db.commit()
    return {"id": qid}
