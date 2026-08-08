import datetime, uuid, hashlib
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from database import get_db
from models import User, Session
from dependencies import hash_password, verify_password, create_token, get_current_user, ACCESS_EXPIRE_MINUTES, REFRESH_EXPIRE_DAYS

router = APIRouter(prefix="/api/auth", tags=["认证"])

class LoginReq(BaseModel):
    username: str
    password: str
    entrance: str = "employee"

class RegisterReq(BaseModel):
    username: str
    displayName: str
    password: str
    role: str = "viewer"

class SetupReq(BaseModel):
    username: str
    displayName: str
    password: str

@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"user": {"id": user.id, "username": user.username, "displayName": user.display_name, "role": user.role}}

@router.post("/login")
async def login(req: LoginReq, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_salt, user.password_hash):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号尚未启用")
    if req.entrance == "admin" and user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="该账号没有管理权限")
    token = create_token({"sub": user.id}, ACCESS_EXPIRE_MINUTES * 48)
    expires = datetime.datetime.utcnow() + datetime.timedelta(days=30)
    db.add(Session(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user.id, expires_at=expires))
    await db.commit()
    return {"token": token, "user": {"id": user.id, "username": user.username, "displayName": user.display_name, "role": user.role}}

@router.post("/register")
async def register(req: RegisterReq, db: AsyncSession = Depends(get_db)):
    if not req.username or not req.displayName:
        raise HTTPException(status_code=400, detail="请输入账号和姓名")
    safe_role = req.role if req.role in ("admin","manager","purchaser","viewer") else "viewer"
    pw = hash_password(req.password)
    user = User(id=str(uuid.uuid4()), username=req.username.strip(), display_name=req.displayName.strip(),
                password_hash=pw["hash"], password_salt=pw["salt"], role=safe_role, status="pending")
    db.add(user)
    await db.commit()
    return {"id": user.id, "status": "pending", "message": "注册成功，请等待管理员启用"}

@router.post("/setup/admin")
async def setup_admin(req: SetupReq, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(func.count()).select_from(User))
    if result.scalar() > 0:
        raise HTTPException(status_code=409, detail="系统已经完成初始化")
    pw = hash_password(req.password)
    user = User(id=str(uuid.uuid4()), username=req.username.strip(), display_name=req.displayName.strip(),
                password_hash=pw["hash"], password_salt=pw["salt"], role="admin", status="active")
    db.add(user)
    await db.commit()
    return {"id": user.id, "role": "admin"}

@router.post("/logout")
async def logout(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return {"ok": True}
