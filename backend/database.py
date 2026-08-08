from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import load_config

config = load_config()
mysql = config["mysql"]
DATABASE_URL = f"mysql+aiomysql://{mysql['user']}:{mysql['password']}@{mysql.get('host','127.0.0.1')}:{mysql.get('port',3306)}/{mysql['database']}?charset=utf8mb4"

engine = create_async_engine(DATABASE_URL, pool_size=12, max_overflow=0, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
