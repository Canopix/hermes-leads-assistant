"""Extract plain text from lead-uploaded documents."""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree

logger = logging.getLogger(__name__)

_TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".log", ".html", ".htm", ".yaml", ".yml"}
_SUPPORTED_EXTENSIONS = _TEXT_EXTENSIONS | {".pdf", ".docx"}


def supported_extensions() -> set[str]:
    return set(_SUPPORTED_EXTENSIONS)


def extract_text(path: Path, max_chars: int = 50_000) -> str:
    ext = path.suffix.lower()
    if ext not in _SUPPORTED_EXTENSIONS:
        return ""

    try:
        if ext in _TEXT_EXTENSIONS:
            raw = path.read_text(encoding="utf-8", errors="replace")
        elif ext == ".pdf":
            raw = _extract_pdf(path)
        elif ext == ".docx":
            raw = _extract_docx(path)
        else:
            raw = ""
    except Exception as exc:
        logger.warning("lead-documents: extract failed for %s: %s", path, exc)
        return ""

    raw = re.sub(r"\n{3,}", "\n\n", raw.strip())
    if len(raw) > max_chars:
        raw = raw[:max_chars] + "\n\n[... contenido truncado ...]"
    return raw


def _extract_pdf(path: Path) -> str:
    text = _extract_pdf_pypdf(path)
    if text.strip():
        return text
    text = _extract_pdf_pdftotext(path)
    return text


def _extract_pdf_pypdf(path: Path) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except ImportError:
        return ""
    try:
        reader = PdfReader(str(path))
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)
    except Exception as exc:
        logger.debug("lead-documents: pypdf failed: %s", exc)
        return ""


def _extract_pdf_pdftotext(path: Path) -> str:
    bin_path = shutil.which("pdftotext")
    if not bin_path:
        return ""
    try:
        proc = subprocess.run(
            [bin_path, "-layout", str(path), "-"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if proc.returncode == 0:
            return proc.stdout or ""
    except Exception as exc:
        logger.debug("lead-documents: pdftotext failed: %s", exc)
    return ""


def _extract_docx(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as zf:
            xml = zf.read("word/document.xml")
    except Exception:
        return ""
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        return ""
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    texts = []
    for node in root.findall(".//w:t", ns):
        if node.text:
            texts.append(node.text)
    return "\n".join(texts)


def display_name_from_path(path: Path) -> str:
    name = path.name
    parts = name.split("_", 2)
    if len(parts) >= 3:
        return parts[2]
    return name
