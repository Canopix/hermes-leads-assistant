"""Lead dashboard API — Kanban board for captured leads."""

from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)
router = APIRouter()

_db_mod = None


def _load_db_module():
    global _db_mod
    if _db_mod is not None:
        return _db_mod
    plugins_dir = Path(__file__).resolve().parents[2]
    db_path = plugins_dir / "lead-capture" / "db.py"
    if not db_path.is_file():
        raise RuntimeError(f"lead-capture db not found at {db_path}")
    spec = importlib.util.spec_from_file_location("lead_capture_db", db_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["lead_capture_db"] = mod
    spec.loader.exec_module(mod)
    _db_mod = mod
    return mod


def _rag_module():
    """Load lead-rag package (hyphenated folder) with relative imports."""
    plugins_dir = Path(__file__).resolve().parents[2]
    rag_dir = plugins_dir / "lead-rag"
    pkg = "lead_rag_plugin"
    for sub in ("embeddings", "fts", "rerank", "vector_store"):
        mod_name = f"{pkg}.{sub}"
        if mod_name in sys.modules:
            continue
        path = rag_dir / f"{sub}.py"
        spec = importlib.util.spec_from_file_location(
            mod_name, path, submodule_search_locations=[str(rag_dir)]
        )
        submod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = submod
        spec.loader.exec_module(submod)
    init_path = rag_dir / "__init__.py"
    if pkg not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            pkg, init_path, submodule_search_locations=[str(rag_dir)]
        )
        mod = importlib.util.module_from_spec(spec)
        mod.__package__ = pkg
        sys.modules[pkg] = mod
        spec.loader.exec_module(mod)
    return sys.modules[pkg]


class LeadPatch(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    interest: str | None = None
    urgency: str | None = None
    summary: str | None = None
    notes: str | None = None
    temperature: str | None = None


class LeadMove(BaseModel):
    column: str
    position: float = Field(default=0.0)


@router.get("/columns")
async def get_columns():
    db = _load_db_module()
    return {"columns": db.KANBAN_COLUMNS}


@router.get("/leads")
async def get_leads():
    db = _load_db_module()
    return {"columns": db.list_leads_by_column()}


@router.get("/leads/{lead_id}")
async def get_lead(lead_id: str):
    db = _load_db_module()
    lead = db.get_lead(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/leads/{lead_id}")
async def patch_lead(lead_id: str, body: LeadPatch):
    db = _load_db_module()
    fields = body.model_dump(exclude_none=True)
    if not db.update_lead(lead_id, fields):
        raise HTTPException(status_code=404, detail="Lead not found or no changes")
    return db.get_lead(lead_id)


@router.post("/leads/{lead_id}/move")
async def move_lead(lead_id: str, body: LeadMove):
    db = _load_db_module()
    if not db.move_lead(lead_id, body.column, body.position):
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"ok": True, "lead": db.get_lead(lead_id)}


@router.get("/stats")
async def stats():
    return _load_db_module().get_stats()


@router.get("/knowledge/status")
async def knowledge_status():
    try:
        rag = _rag_module()
        return rag.knowledge_status()
    except Exception as exc:
        log.warning("knowledge status failed: %s", exc)
        return {"error": str(exc), "chunk_count": 0}


@router.post("/knowledge/reingest")
async def knowledge_reingest():
    try:
        rag = _rag_module()
        count = rag.ingest()
        return {"ok": True, "chunks": count, "status": rag.knowledge_status()}
    except Exception as exc:
        log.exception("reingest failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
