from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging

from models import AdminUser
from config import settings

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        password_bytes = plain_password.encode("utf-8")[:72]
        return pwd_context.verify(
            password_bytes.decode("utf-8", errors="ignore"), hashed_password
        )

    @staticmethod
    def hash_password(password: str) -> str:
        password_bytes = password.encode("utf-8")[:72]
        return pwd_context.hash(password_bytes.decode("utf-8", errors="ignore"))

    def create_access_token(
        self, data: dict, expires_delta: Optional[timedelta] = None
    ) -> str:
        to_encode = data.copy()

        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(
                minutes=settings.access_token_expire_minutes
            )

        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(
            to_encode, settings.secret_key, algorithm=settings.algorithm
        )

        return encoded_jwt

    async def authenticate_admin(
        self, email: str, password: str
    ) -> Optional[AdminUser]:
        result = await self.db.execute(
            select(AdminUser).where(AdminUser.email == email)
        )
        admin = result.scalar_one_or_none()

        if not admin:
            return None

        if not self.verify_password(password, admin.hashed_password):
            return None

        if not admin.is_active:
            return None

        return admin

    async def get_current_admin(self, token: str) -> Optional[AdminUser]:
        try:
            payload = jwt.decode(
                token, settings.secret_key, algorithms=[settings.algorithm]
            )
            admin_id = payload.get("sub")

            if admin_id is None:
                return None

        except JWTError:
            return None

        result = await self.db.execute(
            select(AdminUser).where(AdminUser.id == int(admin_id))
        )
        admin = result.scalar_one_or_none()

        return admin

    async def create_admin(self, email: str, password: str, name: str) -> AdminUser:
        admin = AdminUser(
            email=email,
            hashed_password=self.hash_password(password),
            name=name,
            is_active=True,
        )
        self.db.add(admin)
        await self.db.commit()
        await self.db.refresh(admin)
        return admin
