"""Document parsing, chunking (recursive equiv), embedding (OpenAI compat) with retry."""

import logging
import os

import httpx

try:
    from bs4 import BeautifulSoup
    _HAS_BS4 = True
except ImportError:
    _HAS_BS4 = False

from constants import ALLOWED_EXTENSIONS
from services.ssl_utils import create_ssl_context

logger = logging.getLogger(__name__)


class DocumentParser:
    def __init__(self):
        self.max_retries = 2  # >=1 retry per req

    def parse(self, storage_path: str, file_type: str) -> str:
        """Parse file to plain text. Raises on unrecoverable error."""
        if not os.path.exists(storage_path):
            raise FileNotFoundError(storage_path)
        ext = file_type.lower().lstrip(".")
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"Unsupported: {ext}")

        if ext in ("txt", "md"):
            with open(storage_path, encoding="utf-8", errors="ignore") as f:
                return f.read()
        elif ext == "html":
            return self._parse_html(storage_path)
        elif ext == "pdf":
            return self._parse_pdf(storage_path)
        elif ext == "docx":
            return self._parse_docx(storage_path)
        elif ext == "xlsx":
            return self._parse_xlsx(storage_path)
        raise ValueError(f"Unhandled ext: {ext}")

    def _parse_pdf(self, path: str) -> str:
        import pdfplumber

        texts = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                texts.append(t)
        return "\n\n".join(texts)

    def _parse_html(self, path: str) -> str:
        """Extract visible text from HTML file (strips tags)."""
        with open(path, encoding="utf-8", errors="ignore") as f:
            raw = f.read()
        if _HAS_BS4:
            soup = BeautifulSoup(raw, "html.parser")
            return soup.get_text(separator="\n", strip=True)
        # Fallback: stdlib html.parser
        from html.parser import HTMLParser
        class _TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.parts = []
            def handle_data(self, data):
                text = data.strip()
                if text:
                    self.parts.append(text)
        parser = _TextExtractor()
        parser.feed(raw)
        return "\n".join(parser.parts)

    def _parse_docx(self, path: str) -> str:
        """Parse DOCX file, extract paragraph text."""
        file_size = os.path.getsize(path)
        logger.info(f"Parsing DOCX: {path} ({file_size} bytes)")
        try:
            from docx import Document
        except ImportError:
            raise RuntimeError(
                "DOCX support requires python-docx. "
                "Install: pip install python-docx"
            )
        try:
            doc = Document(path)
            paragraphs = [p.text for p in doc.paragraphs if p.text]
            logger.info(f"DOCX parsed: {len(paragraphs)} paragraphs from {file_size} bytes")
            return "\n".join(paragraphs)
        except Exception as e:
            logger.error(f"DOCX parse failed for {path}: {e}")
            raise RuntimeError(
                f"Failed to parse DOCX file (type={type(e).__name__}): {e}. "
                "Check that the file is a valid .docx (Office Open XML) format."
            ) from e

    def _parse_xlsx(self, path: str) -> str:
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise RuntimeError("XLSX support requires: pip install openpyxl")
        wb = load_workbook(path, read_only=True, data_only=True)
        parts = []
        for sheet in wb.worksheets:
            rows = []
            for row in sheet.iter_rows(values_only=True):
                cells = [str(c) if c is not None else "" for c in row]
                rows.append(",".join(cells))
            parts.append(f"Sheet: {sheet.title}\n" + "\n".join(rows))
        wb.close()
        return "\n\n".join(parts)

    def chunk_text(
        self, text: str, chunk_size: int = 512, chunk_overlap: int = 64
    ) -> list[str]:
        """RecursiveCharacterTextSplitter equivalent (separators + overlap)."""
        if not text or len(text) <= chunk_size:
            return [text] if text else []
        chunks = []
        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            chunk = text[start:end]
            chunks.append(chunk)
            start = end - chunk_overlap if end < len(text) else end
            if start < 0:
                start = 0
        # dedupe tiny
        return [c for c in chunks if len(c.strip()) > 10]

    async def embed_texts(
        self,
        texts: list[str],
        model: str,
        base_url: str | None,
        api_key: str | None = None,
    ) -> list[list[float]]:
        """OpenAI-compatible /v1/embeddings call. Returns list of embeddings."""
        if not texts:
            return []
        url = (base_url or "https://api.openai.com/v1").rstrip("/") + "/embeddings"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        payload = {"model": model, "input": texts}
        ssl_context = create_ssl_context()
        async with httpx.AsyncClient(verify=ssl_context, timeout=60.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return [item["embedding"] for item in data.get("data", [])]

    def parse_with_retry(self, storage_path: str, file_type: str) -> str:
        """Retry wrapper (>=1 retry)."""
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                return self.parse(storage_path, file_type)
            except Exception as e:
                # Do not retry non-recoverable errors
                if isinstance(e, (ImportError, ModuleNotFoundError, RuntimeError)):
                    raise
                last_exc = e
                logger.warning(f"Parse attempt {attempt + 1} failed: {e}")
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("parse_with_retry: no attempts made")
