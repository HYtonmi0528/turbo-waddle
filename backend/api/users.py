import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, Notification
from dependencies import get_current_user, require_role

router = APIRouter(prefix="/api/users", tags=["用户"])

@router.get("")
async def list_users(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(User).order_by(User.role, User.display_name))
    users = result.scalars().all()
    return {"users": [{"id": u.id, "username": u.username, "displayName": u.display_name, "role": u.role, "status": u.status, "createdAt": u.created_at.isoformat() if u.created_at else None} for u in users]}

@router.patch("/{user_id}/status")
async def update_status(user_id: str, status: str = "active",
                        user: User = Depends(require_role("admin")),
                        db: AsyncSession = Depends(get_db)):
    if status not in ("active", "disabled"): raise HTTPException(400, "无效状态")
    await db.execute(select(User).where(User.id == user_id))
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target: raise HTTPException(404)
    target.status = status; target.updated_at = datetime.datetime.utcnow()
    await db.commit()
    return {"ok": True}

@router.patch("/{user_id}/role")
async def update_role(user_id: str, role: str,
                      user: User = Depends(require_role("admin")),
                      db: AsyncSession = Depends(get_db)):
    if role not in ("admin", "manager", "purchaser", "viewer"): raise HTTPException(400, "无效角色")
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target: raise HTTPException(404)
    target.role = role; target.updated_at = datetime.datetime.utcnow()
    await db.commit()
    return {"ok": True}
