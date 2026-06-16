"""
Shared application constants.

Centralised limits and configuration values used across the backend.
Keep this module importable without side effects.
"""

# --- Body size limits ---
DEFAULT_BODY_SIZE_LIMIT = 10 * 1024 * 1024  # 10 MiB — global default for non-upload routes
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MiB — per-file limit for uploads
MAX_FILES_PER_UPLOAD = 5  # max files per single upload request
MULTIPART_OVERHEAD = 5 * 1024 * 1024  # 5 MiB — buffer for multipart metadata overhead
FILE_UPLOAD_BODY_LIMIT = (
    MAX_FILES_PER_UPLOAD * MAX_FILE_SIZE + MULTIPART_OVERHEAD
)  # 105 MiB — total body limit for file upload route

# --- File upload ---
ALLOWED_EXTENSIONS = frozenset({"txt", "md", "html", "pdf", "docx", "xlsx"})
