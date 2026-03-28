from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from sqlalchemy import select, func

from database import get_db
from models import AdminUser
from services.auth_service import AuthService
from i18n.core import get_locale_from_request, _

router = APIRouter()
security = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: dict


class AdminResponse(BaseModel):
    id: int
    email: str
    name: str


async def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> AdminUser:
    locale = get_locale_from_request(request)

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Invalid credentials", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )

    auth_service = AuthService(db)
    admin = await auth_service.get_current_admin(credentials.credentials)

    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Invalid credentials", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )

    return admin


@router.post("/register", response_model=AdminResponse)
async def register(request: Request, req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    locale = get_locale_from_request(request)
    auth_service = AuthService(db)

    admin_count_result = await db.execute(select(func.count(AdminUser.id)))
    admin_count = admin_count_result.scalar()

    if admin_count and admin_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_("System already has an administrator", locale=locale),
        )

    result = await db.execute(select(AdminUser).where(AdminUser.email == req.email))
    existing_admin = result.scalar_one_or_none()

    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_("Email already registered", locale=locale)
        )

    if len(req.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_("Password too short", locale=locale),
        )

    admin = await auth_service.create_admin(
        email=req.email, password=req.password, name=req.name
    )

    return AdminResponse(id=admin.id, email=admin.email, name=admin.name)


@router.post("/login", response_model=LoginResponse)
async def login(request: Request, req: LoginRequest, db: AsyncSession = Depends(get_db)):
    locale = get_locale_from_request(request)
    auth_service = AuthService(db)

    admin = await auth_service.authenticate_admin(
        email=req.email, password=req.password
    )

    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Invalid credentials", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = auth_service.create_access_token(data={"sub": str(admin.id)})

    return LoginResponse(
        access_token=access_token,
        admin={"id": admin.id, "email": admin.email, "name": admin.name},
    )


@router.get("/me", response_model=AdminResponse)
async def get_me(current_admin: AdminUser = Depends(get_current_admin)):
    return AdminResponse(
        id=current_admin.id,
        email=current_admin.email,
        name=current_admin.name,
    )
