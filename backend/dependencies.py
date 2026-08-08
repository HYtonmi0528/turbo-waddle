import hashlib, secrets, os, datetime
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, Session
from config import load_config

def hash_password(password: str) -> dict:
    salt = os.urandom(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    return {"hash": key.hex(), "salt": salt.hex()}

def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    if not salt_hex or not hash_hex: return False
    salt = bytes.fromhex(salt_hex) if len(salt_hex) > 30 else salt_hex.encode()
    if isinstance(salt, str): salt = salt[:16]
    key = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    return key.hex() == hash_hex

# Remove old bcrypt code
bearer = HTTPBearer(auto_error=False)
config = load_config()
JWT_SECRET = config.get("sessionSecret", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
ACCESS_EXPIRE_MINUTES = 30
REFRESH_EXPIRE_DAYS = 30

def create_token(data: dict, expires_delta: int) -> str:
    from jose import jwt
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=expires_delta)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db)
) -> User:
    from jose import jwt, JWTError
    token = credentials.credentials if credentials else None
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token无效")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token已过期")

    # Check DB session
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    result = await db.execute(
        select(User).join(Session, Session.user_id == User.id)
        .where(Session.token_hash == token_hash, Session.expires_at > datetime.datetime.utcnow(), User.status == "active")
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效")
    return user

def require_role(*roles: str):
    async def dependency(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return user
    return dependency
