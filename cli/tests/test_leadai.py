"""
Unit tests for leadai.py helpers that don't need a real Hermes install.

These cover the parts of the CLI that operate on the tenants registry file:
load/save/get. Shell-out commands (subprocess.run) are out of scope here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make cli/ importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def leadai(monkeypatch, tmp_path):
    """Import leadai with TENANTS_FILE pointed at a tmp path."""
    fake_tenants = tmp_path / "tenants.json"
    import importlib

    import leadai  # type: ignore

    importlib.reload(leadai)  # ensure a fresh module state per test
    # Patch AFTER reload, otherwise reload overwrites TENANTS_FILE with the
    # original computed value.
    monkeypatch.setattr(leadai, "TENANTS_FILE", fake_tenants)
    return leadai


def write_tenants(path: Path, tenants: list[dict]):
    path.write_text(json.dumps({"tenants": tenants}))


# ----------------------------------------------------------------------
# load_tenants
# ----------------------------------------------------------------------

def test_load_tenants_returns_empty_when_file_missing(leadai, tmp_path):
    # Default fixture has no tenants.json yet.
    data = leadai.load_tenants()
    assert data == {"tenants": []}


def test_load_tenants_reads_existing_file(leadai):
    write_tenants(leadai.TENANTS_FILE, [
        {"slug": "a", "name": "A", "status": "active"},
    ])
    data = leadai.load_tenants()
    assert len(data["tenants"]) == 1
    assert data["tenants"][0]["slug"] == "a"


# ----------------------------------------------------------------------
# save_tenants
# ----------------------------------------------------------------------

def test_save_then_load_roundtrip(leadai):
    payload = {"tenants": [
        {"slug": "acme", "name": "Acme", "status": "active", "channels": ["telegram"]},
    ]}
    leadai.save_tenants(payload)
    loaded = leadai.load_tenants()
    assert loaded == payload


def test_save_tenants_pretty_prints(leadai):
    leadai.save_tenants({"tenants": []})
    # indent=2 ⇒ at least one line with two leading spaces somewhere
    contents = leadai.TENANTS_FILE.read_text()
    assert "\n  " in contents


# ----------------------------------------------------------------------
# get_tenant
# ----------------------------------------------------------------------

def test_get_tenant_finds_by_slug(leadai):
    write_tenants(leadai.TENANTS_FILE, [
        {"slug": "alpha", "name": "Alpha"},
        {"slug": "beta", "name": "Beta"},
    ])
    found = leadai.get_tenant("beta")
    assert found is not None
    assert found["name"] == "Beta"


def test_get_tenant_returns_none_when_missing(leadai):
    write_tenants(leadai.TENANTS_FILE, [{"slug": "alpha", "name": "Alpha"}])
    assert leadai.get_tenant("zzz") is None


def test_get_tenant_handles_missing_file(leadai):
    # No file exists yet → should not raise.
    assert leadai.get_tenant("anything") is None
