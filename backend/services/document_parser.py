"""Document parsing, chunking (recursive equiv), embedding (OpenAI compat) with retry."""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

# Supported extensions
SUPPORTED_EXTS = {"txt", "md", "html", "pdf", "docx", "xlsx"}


class DocumentParser:
    def __init__(self):
        self.max_retries = 2  # >=1 retry per req

    def parse(self, storage_path: str, file_type: str) -> str:
        """Parse file to plain text. Raises on unrecoverable error."""
        if not os.path.exists(storage_path):
            raise FileNotFoundError(storage_path)
        ext = file_type.lower().lstrip(".")
        if ext not in SUPPORTED_EXTS:
            raise ValueError(f"Unsupported: {ext}")

        if ext in ("txt", "md", "html"):
            with open(storage_path, encoding="utf-8", errors="ignore") as f:
                return f.read()
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

    def _parse_docx(self, path: str) -> str:
        from docx import Document

        doc = Document(path)
        return "\n".join(p.text for p in doc.paragraphs)

    def _parse_xlsx(self, path: str) -> str:
        from openpyxl import load_workbook

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
        async with httpx.AsyncClient(timeout=60.0) as client:
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
                last_exc = e
                logger.warning(f"Parse attempt {attempt+1} failed: {e}")
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("parse_with_retry: no attempts made")
