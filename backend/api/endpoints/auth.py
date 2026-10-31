import asyncio
import hashlib
import logging
from typing import Deque, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from database import get_db
from models import AdminUser, Workspace, WorkspaceQuota, AgentMember
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
logger = logging.getLogger(__name__)

# In-memory login rate limiter (fallback when Redis is unavailable)
_login_attempt_history: dict[str, Deque[float]] = defaultdict(deque)

# Two counters, keyed the same way in Redis and in memory: one per client IP and
# one per submitted email. The IP key alone is trivially reset by rotating
# `X-Forwarded-For`; the account key is what makes that rotation useless.
LOGIN_IP_KEY_PREFIX = "login:ip:"
LOGIN_ACCOUNT_KEY_PREFIX = "login:acct:"

def login_account_key(email: str) -> str:
    """Rate-limit key for a submitted email (hashed: no address in Redis)."""
    digest = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    return f"{LOGIN_ACCOUNT_KEY_PREFIX}{digest}"

def _check_login_rate_limit(
    key: str, max_attempts: int, window_seconds: int
) -> tuple[bool, int]:
    """In-memory sliding window. Returns (allowed, retry_after_seconds).

    Read-only on purpose: recording is `_record_login_failure`'s job. Appending
    here is what used to charge a *successful* login to the brute-force budget.
    """
    from middleware.rate_limit import count_memory_sliding_window

    count = count_memory_sliding_window(
        _login_attempt_history, key, window_seconds=window_seconds
    )
    if count < max_attempts:
        return True, 0

    history = _login_attempt_history.get(key)
    oldest = history[0] if history else time.time()
    retry_after = int(window_seconds - (time.time() - oldest)) + 1
    return False, max(retry_after, 1)

def _record_login_failure(key: str) -> None:
    """Charge one failed login attempt against `key`."""
    from middleware.rate_limit import record_memory_sliding_window

    record_memory_sliding_window(_login_attempt_history, key)

async def _login_keys_over_limit(
    keys: list[str], max_attempts: int, window_seconds: int
) -> tuple[bool, int]:
    """Is any of `keys` over budget? Records nothing, in Redis or in memory."""
    from middleware.rate_limit import count_redis_sliding_window
    from services.redis_service import get_redis

    try:
        redis_svc = await get_redis()
    except Exception as exc:  # pragma: no cover - get_redis is a dict lookup
        logger.warning("Login limiter: no Redis (%s); using memory", exc)
        redis_svc = None

    if redis_svc is not None:
        try:
            for key in keys:
                count = await count_redis_sliding_window(
                    redis_svc, key, window_seconds
                )
                if count >= max_attempts:
                    return False, window_seconds
            return True, 0
        except Exception as exc:
            # Redis error — fall through to the in-memory limiter.
            logger.warning("Login limiter: Redis error (%s); using memory", exc)

    for key in keys:
        allowed, retry_after = _check_login_rate_limit(
            key, max_attempts, window_seconds
        )
        if not allowed:
            return False, retry_after
    return True, 0

async def _record_login_failure_everywhere(keys: list[str], window_seconds: int) -> None:
    """Charge one failed attempt against every key, Redis-first with memory fallback."""
    from middleware.rate_limit import record_redis_sliding_window
    from services.redis_service import get_redis

    recorded_in_redis = False
    try:
        redis_svc = await get_redis()
    except Exception:
        redis_svc = None

    if redis_svc is not None:
        try:
            for key in keys:
                await record_redis_sliding_window(redis_svc, key, window_seconds)
            recorded_in_redis = True
        except Exception as exc:
            logger.warning("Login limiter: Redis error on record (%s)", exc)

    if not recorded_in_redis:
        for key in keys:
            _record_login_failure(key)


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

class ChangePasswordRequest(BaseModel):
    """Self-service password change (account settings page)."""

    current_password: str
    new_password: str


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

async def _ensure_example_agent_quietly(workspace_id: Optional[int]) -> None:
    """Seed the built-in example agent, never at the cost of the request.

    Called after a successful registration/login. The local embedding container may
    be down (or still downloading the model), so any exception — including an
    import failure — is logged and swallowed: the caller still returns a token.
    The seed itself is idempotent, so the next login simply retries.
    """
    if not workspace_id:
        return
    try:
        from services.example_seed import ensure_example_agent

        await ensure_example_agent(workspace_id)
    except Exception as exc:
        logger.warning(
            "Example agent seed skipped for workspace %s (%s: %s)",
            workspace_id,
            type(exc).__name__,
            exc,
        )


@router.post("/register", response_model=LoginResponse)
async def register(
    request: Request, req: RegisterRequest, db: AsyncSession = Depends(get_db)
):
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
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_("Email already registered", locale=locale),
            )

        if len(req.password) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_("Password too short", locale=locale),
            )

        # Create default workspace and quota for first admin
        workspace = Workspace(
            name="Default Workspace",
            owner_email=req.email,
        )
        db.add(workspace)
        await db.flush()

        quota = WorkspaceQuota(workspace_id=workspace.id)
        db.add(quota)
        await db.flush()

        admin = await auth_service.create_admin(
            email=req.email,
            password=req.password,
            name=req.name,
            role="super_admin",
            workspace_id=workspace.id,
        )

    access_token = auth_service.create_access_token(data={"sub": str(admin.id)})

    await _ensure_example_agent_quietly(admin.workspace_id)

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        admin={
            "id": admin.id,
            "email": admin.email,
            "name": admin.name,
            "role": admin.role,
        },
    )


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

    if not current_admin.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )

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
        workspace_id=current_admin.workspace_id,
    )

    return AdminResponse(
        id=admin.id, email=admin.email, name=admin.name, role=admin.role
    )


@router.get("/users", response_model=list[AdminUserOut])
async def list_admin_users(
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_admin)
    if not current_admin.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )
    result = await db.execute(
        select(AdminUser)
        .where(AdminUser.workspace_id == current_admin.workspace_id)
        .order_by(AdminUser.id.asc())
    )
    return result.scalars().all()


@router.patch("/users/{admin_id}", response_model=AdminUserOut)
async def update_admin_user(
    admin_id: int,
    req: UpdateAdminRequest,
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_admin)
    if not current_admin.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )
    result = await db.execute(
        select(AdminUser).where(
            AdminUser.id == admin_id,
            AdminUser.workspace_id == current_admin.workspace_id,
        )
    )
    admin = result.scalar_one_or_none()

    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin user not found in your workspace",
        )

    if req.email and req.email != admin.email:
        existing = await db.execute(
            select(AdminUser).where(AdminUser.email == req.email)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
        admin.email = req.email

    if req.name is not None:
        admin.name = req.name

    if req.password:
        if len(req.password) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Password too short"
            )
        admin.hashed_password = AuthService.hash_password(req.password)

    if req.role is not None:
        validate_admin_role(req.role)
        if admin.id == current_admin.id and req.role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot remove your own super admin role",
            )
        # When downgrading from super_admin, delete ALL AgentMember records
        # Super admins use workspace-based auth (no membership needed)
        # After downgrade, agent access must be explicitly re-assigned via /agents/{id}/members
        if admin.role == "super_admin" and req.role != "super_admin":
            await db.execute(
                delete(AgentMember).where(AgentMember.admin_user_id == admin.id)
            )
        admin.role = req.role

    if req.is_active is not None:
        if admin.id == current_admin.id and req.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot disable yourself",
            )
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete yourself"
        )

    if not current_admin.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )

    result = await db.execute(
        select(AdminUser).where(
            AdminUser.id == admin_id,
            AdminUser.workspace_id == current_admin.workspace_id,
        )
    )
    admin = result.scalar_one_or_none()

    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin user not found in your workspace",
        )

    await db.delete(admin)
    await db.commit()
    return {"ok": True}


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request, req: LoginRequest, db: AsyncSession = Depends(get_db)
):
    from middleware.rate_limit import get_request_client_ip

    locale = get_locale_from_request(request)
    from config import settings as cfg

    max_attempts = cfg.login_rate_limit_max_attempts
    window_seconds = cfg.login_rate_limit_window_seconds
    ip = get_request_client_ip(request)
    attempt_keys = [f"{LOGIN_IP_KEY_PREFIX}{ip}", login_account_key(req.email)]

    def _too_many(retry_after: int) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_("Too many login attempts. Please try again later.", locale=locale),
            headers={"Retry-After": str(retry_after)},
        )

    # Check BEFORE authenticating, record only on failure. Recording the check
    # itself charged successful logins to a brute-force budget, and the IP key
    # alone was resettable by rotating a client-supplied `X-Forwarded-For`.
    allowed, retry_after = await _login_keys_over_limit(
        attempt_keys, max_attempts, window_seconds
    )
    if not allowed:
        raise _too_many(retry_after)

    auth_service = AuthService(db)

    try:
        admin = await auth_service.authenticate_admin(
            email=req.email, password=req.password
        )
    except AdminDeactivatedError:
        # Only reachable once the password matched, so this leaks nothing about
        # which addresses exist.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_("Account has been deactivated", locale=locale),
        )
    except AuthError:
        # AdminNotFoundError is an AuthError: one generic sentence and one status
        # for "no such account" and "wrong password" alike. Distinguishing them
        # turned the login form into an account-existence oracle.
        await _record_login_failure_everywhere(attempt_keys, window_seconds)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_("Invalid email or password", locale=locale),
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = auth_service.create_access_token(data={"sub": str(admin.id)})

    # A brand-new deployment has no agent yet: this is where the built-in example
    # appears for the very first super admin. Non-fatal by design.
    await _ensure_example_agent_quietly(admin.workspace_id)

    return LoginResponse(
        access_token=access_token,
        admin={
            "id": admin.id,
            "email": admin.email,
            "name": admin.name,
            "role": admin.role,
        },
    )


@router.get("/me", response_model=AdminResponse)
async def get_me(current_admin: AdminUser = Depends(get_current_admin)):
    return AdminResponse(
        id=current_admin.id,
        email=current_admin.email,
        name=current_admin.name,
        role=current_admin.role,
    )

@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_own_password(
    req: ChangePasswordRequest,
    request: Request,
    current_admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Change the caller's own password (account settings page).

    Independent of the admin-management `PATCH /users/{admin_id}` flow, which keeps
    its own rules (super-admin only, optional password).
    """
    # The admin SPA always sends a browser Accept-Language, so a real UI gets a
    # translated message. A request that declares no locale at all (plain API
    # client) keeps the historical English text, which is also what the en_US
    # msgids are.
    declared_locale = get_locale_from_request(request) if (
        request.query_params.get("locale") or request.headers.get("accept-language")
    ) else None

    def _detail(msgid: str) -> str:
        return _(msgid, locale=declared_locale) if declared_locale else msgid

    if not AuthService.verify_password(req.current_password, current_admin.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_detail("Current password is incorrect"),
        )

    if len(req.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_detail("Password too short"),
        )

    current_admin.hashed_password = AuthService.hash_password(req.new_password)
    await db.commit()
    return None
