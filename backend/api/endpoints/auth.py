import asyncio
from typing import Deque, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from sqlalchemy import select, func
from database import get_db
from models import AdminUser
from services.auth_service import (
    AuthService,
    AuthError,
    TokenExpiredError,
    TokenInvalidError,
    AdminNotFoundError,
    AdminDeactivatedError,
)
from i18n.core import get_locale_from_request, _

import time
from collections import defaultdict, deque

router = APIRouter()
security = HTTPBearer(auto_error=False)

# In-memory login rate limiter (fallback when Redis is unavailable)
_login_attempt_history: dict[str, Deque[float]] = defaultdict(deque)


def _check_login_rate_limit(ip: str, max_attempts: int, window_seconds: int) -> tuple[bool, int]:
    """In-memory sliding-window rate limit. Returns (allowed, retry_after_seconds)."""
    now = time.time()
    history = _login_attempt_history[ip]
    while history and now - history[0] >= window_seconds:
        history.popleft()
    if not history:
        _login_attempt_history.pop(ip, None)
        return True, 0
    if len(history) >= max_attempts:
        retry_after = int(window_seconds - (now - history[0])) + 1
        return False, max(retry_after, 1)
    history.append(now)
    return True, 0

# Prevent concurrent first-admin bootstrap from creating multiple super_admin accounts
_bootstrap_lock = asyncio.Lock()


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str

class CreateAdminRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str = "admin"
    
class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: dict


class AdminResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str

class AdminUserOut(BaseModel):
    id: int
    email: str
    name: str
    is_active: bool
    role: str


class UpdateAdminRequest(BaseModel):
    email: Optional[str] = None
    name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None
    
class RegistrationSettingsResponse(BaseModel):
    public_registration_enabled: bool
    bootstrap_required: bool


class RegistrationSettingsUpdate(BaseModel):
    public_registration_enabled: bool
async def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> AdminUser:
    locale = get_locale_from_request(request)

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Not logged in", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )

    auth_service = AuthService(db)
    try:
        admin = await auth_service.get_current_admin(credentials.credentials)
    except TokenExpiredError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Session expired, please log in again", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )
    except TokenInvalidError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Invalid credentials", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )
    except AdminNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("User not found", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )
    except AdminDeactivatedError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_("Account has been deactivated", locale=locale),
        )

    return admin

VALID_ADMIN_ROLES = {"super_admin", "admin", "support"}


def require_super_admin(current_admin: AdminUser):
    if current_admin.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super administrators can manage users",
        )


async def require_admin_or_super_admin(
    current_admin: AdminUser = Depends(get_current_admin),
) -> AdminUser:
    if current_admin.role not in ("super_admin", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return current_admin


async def require_chat_operator(
    current_admin: AdminUser = Depends(get_current_admin),
) -> AdminUser:
    if current_admin.role not in ("super_admin", "admin", "support"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return current_admin


def validate_admin_role(role: str):
    if role not in VALID_ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role",
        )

@router.post("/register", response_model=AdminResponse)
async def register(request: Request, req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    locale = get_locale_from_request(request)
    auth_service = AuthService(db)

    async with _bootstrap_lock:
        admin_count_result = await db.execute(select(func.count(AdminUser.id)))
        admin_count = admin_count_result.scalar() or 0

        # Only allow unauthenticated first-time super-admin bootstrap.
        # After the first admin exists, all further admin creation must go
        # through the authenticated /api/admin/users endpoint.
        if admin_count > 0:
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
            email=req.email, password=req.password, name=req.name, role="super_admin"
        )

    return AdminResponse(id=admin.id, email=admin.email, name=admin.name, role=admin.role)

@router.get("/registration-settings", response_model=RegistrationSettingsResponse)
async def get_registration_settings(db: AsyncSession = Depends(get_db)):
    admin_count_result = await db.execute(select(func.count(AdminUser.id)))
    admin_count = admin_count_result.scalar() or 0

    return RegistrationSettingsResponse(
        public_registration_enabled=False,
        bootstrap_required=admin_count == 0,
    )


@router.patch("/registration-settings", response_model=RegistrationSettingsResponse)
async def update_registration_settings(
    req: RegistrationSettingsUpdate,
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_admin)

    admin_count_result = await db.execute(select(func.count(AdminUser.id)))
    admin_count = admin_count_result.scalar() or 0

    return RegistrationSettingsResponse(
        public_registration_enabled=False,
        bootstrap_required=admin_count == 0,
    )

@router.post("/users", response_model=AdminResponse)
async def create_admin_user(
    request: Request,
    req: CreateAdminRequest,
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_admin)
    validate_admin_role(req.role)
    locale = get_locale_from_request(request)
    auth_service = AuthService(db)

    result = await db.execute(select(AdminUser).where(AdminUser.email == req.email))
    existing_admin = result.scalar_one_or_none()

    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_("Email already registered", locale=locale),
        )

    if len(req.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_("Password too short", locale=locale),
        )

    admin = await auth_service.create_admin(
        email=req.email,
        password=req.password,
        name=req.name,
        role=req.role,
    )

    return AdminResponse(id=admin.id, email=admin.email, name=admin.name, role=admin.role)

@router.get("/users", response_model=list[AdminUserOut])
async def list_admin_users(
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_admin)
    result = await db.execute(select(AdminUser).order_by(AdminUser.id.asc()))
    return result.scalars().all()


@router.patch("/users/{admin_id}", response_model=AdminUserOut)
async def update_admin_user(
    admin_id: int,
    req: UpdateAdminRequest,
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_admin)
    result = await db.execute(select(AdminUser).where(AdminUser.id == admin_id))
    admin = result.scalar_one_or_none()

    if not admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin user not found")

    if req.email and req.email != admin.email:
        existing = await db.execute(select(AdminUser).where(AdminUser.email == req.email))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
        admin.email = req.email

    if req.name is not None:
        admin.name = req.name

    if req.password:
        if len(req.password) < 8:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password too short")
        admin.hashed_password = AuthService.hash_password(req.password)
        
    if req.role is not None:
        validate_admin_role(req.role)
        if admin.id == current_admin.id and req.role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot remove your own super admin role",
            )
        admin.role = req.role

    if req.is_active is not None:
        if admin.id == current_admin.id and req.is_active is False:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot disable yourself")
        admin.is_active = req.is_active

    await db.commit()
    await db.refresh(admin)
    return admin


@router.delete("/users/{admin_id}")
async def delete_admin_user(
    admin_id: int,
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_admin)
    if admin_id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete yourself")

    result = await db.execute(select(AdminUser).where(AdminUser.id == admin_id))
    admin = result.scalar_one_or_none()

    if not admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin user not found")

    await db.delete(admin)
    await db.commit()
    return {"ok": True}


@router.post("/login", response_model=LoginResponse)
async def login(request: Request, req: LoginRequest, db: AsyncSession = Depends(get_db)):
    from middleware.rate_limit import get_request_client_ip
    from services.redis_service import get_redis

    locale = get_locale_from_request(request)

    # Rate-limit login attempts per client IP to prevent brute-force attacks.
    # Redis-first with in-memory fallback so protection never disappears.
    from config import settings as cfg
    max_attempts = cfg.login_rate_limit_max_attempts
    window_seconds = cfg.login_rate_limit_window_seconds
    ip = get_request_client_ip(request)
    redis_svc = await get_redis()
    if redis_svc is not None:
        try:
            login_key = f"login:ip:{ip}"
            allowed, _remaining = await redis_svc.check_rate_limit(
                login_key, max_requests=max_attempts, window_seconds=window_seconds
            )
            if not allowed:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=_("Too many login attempts. Please try again later.", locale=locale),
                    headers={"Retry-After": str(window_seconds)},
                )
        except HTTPException:
            raise
        except Exception:
            # Redis error — fall through to in-memory limiter.
            allowed, retry_after = _check_login_rate_limit(ip, max_attempts, window_seconds)
            if not allowed:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=_("Too many login attempts. Please try again later.", locale=locale),
                    headers={"Retry-After": str(retry_after)},
                )
    else:
        allowed, retry_after = _check_login_rate_limit(ip, max_attempts, window_seconds)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=_("Too many login attempts. Please try again later.", locale=locale),
                headers={"Retry-After": str(retry_after)},
            )

    auth_service = AuthService(db)

    try:
        admin = await auth_service.authenticate_admin(
            email=req.email, password=req.password
        )
    except AdminNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("No account found with this email", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )
    except AdminDeactivatedError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_("Account has been deactivated", locale=locale),
        )
    except AuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Incorrect password", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = auth_service.create_access_token(data={"sub": str(admin.id)})

    return LoginResponse(
        access_token=access_token,
        admin={"id": admin.id, "email": admin.email, "name": admin.name,"role": admin.role},
    )


@router.get("/me", response_model=AdminResponse)
async def get_me(current_admin: AdminUser = Depends(get_current_admin)):
    return AdminResponse(
        id=current_admin.id,
        email=current_admin.email,
        name=current_admin.name,
        role=current_admin.role
    )
