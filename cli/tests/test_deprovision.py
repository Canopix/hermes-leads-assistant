"""
Integration-style tests for provision_destroy's archive logic.

We don't invoke the Typer CLI — we call the underlying helpers directly with
patched paths, then assert on filesystem state and the tenants registry.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def workspace(monkeypatch, tmp_path):
    """Build a tiny fake workspace with a profile + tenants.json."""
    profiles = tmp_path / "profiles"
    backups = tmp_path / "backups"
    profiles.mkdir()
    backups.mkdir()

    profile_dir = profiles / "demo-leads"
    profile_dir.mkdir()
    (profile_dir / "leads.db").write_text("FAKE LEAD DATA")
    (profile_dir / "config.yaml").write_text("channels: []\n")

    tenants_file = tmp_path / "tenants.json"
    tenants_file.write_text(json.dumps({
        "tenants": [
            {
                "slug": "demo",
                "name": "Demo Tenant",
                "hermes_profile": "demo-leads",
                "status": "active",
                "channels": ["telegram"],
            }
        ]
    }))

    return {
        "profiles": profiles,
        "backups": backups,
        "tenants_file": tenants_file,
        "profile_dir": profile_dir,
        "slug": "demo",
    }


def _import_leadai(monkeypatch, workspace):
    """Import leadai with paths patched to the test workspace."""
    import importlib

    import leadai  # type: ignore

    monkeypatch.setattr(leadai, "TENANTS_FILE", workspace["tenants_file"])
    monkeypatch.setattr(leadai, "HERMES_PROFILES_DIR", workspace["profiles"])

    # Stub bot_stop so we don't shell out to hermes.
    monkeypatch.setattr(leadai, "bot_stop", lambda slug: None)

    importlib.reload(leadai)
    # Re-apply patches after reload.
    monkeypatch.setattr(leadai, "TENANTS_FILE", workspace["tenants_file"])
    monkeypatch.setattr(leadai, "HERMES_PROFILES_DIR", workspace["profiles"])
    monkeypatch.setattr(leadai, "bot_stop", lambda slug: None)
    return leadai


def test_provision_destroy_creates_encrypted_backup_and_wipes_profile(
    monkeypatch, workspace
):
    leadai = _import_leadai(monkeypatch, workspace)
    slug = workspace["slug"]

    from typer.testing import CliRunner
    runner = CliRunner()

    result = runner.invoke(
        leadai.app,
        [
            "provision-destroy", slug, "--force",
            "--archive-dir", str(workspace["backups"]),
            "--archive-pass", "supersecret",
        ],
    )
    assert result.exit_code == 0, result.stdout

    # The profile directory is gone.
    assert not workspace["profile_dir"].exists()

    # An encrypted archive was created, with 0o600 perms.
    archives = list(workspace["backups"].glob(f"{slug}-*.tar.gz.enc"))
    assert len(archives) == 1
    archive = archives[0]
    assert archive.stat().st_mode & 0o777 == 0o600

    # No plaintext tar was left behind.
    plaintext = list(workspace["backups"].glob(f"{slug}-*.tar.gz"))
    assert plaintext == []

    # The tenant is marked suspended (NOT deleted), with deprovisioned_at.
    data = json.loads(workspace["tenants_file"].read_text())
    assert len(data["tenants"]) == 1
    tenant = data["tenants"][0]
    assert tenant["status"] == "suspended"
    assert "deprovisioned_at" in tenant


def test_encrypted_backup_is_round_tripp(monkeypatch, workspace, tmp_path):
    """Verify the archive can be decrypted with the same passphrase and the
    original file contents are intact — this is the whole point of the
    archive step."""
    leadai = _import_leadai(monkeypatch, workspace)

    from typer.testing import CliRunner
    runner = CliRunner()

    result = runner.invoke(
        leadai.app,
        [
            "provision-destroy", workspace["slug"], "--force",
            "--archive-dir", str(workspace["backups"]),
            "--archive-pass", "roundtrip-pass",
        ],
    )
    assert result.exit_code == 0

    archive = next(workspace["backups"].glob("*.tar.gz.enc"))

    # Decrypt + extract to a clean dir.
    out = tmp_path / "restore"
    out.mkdir()
    plaintext_tar = out / "decrypted.tar.gz"
    subprocess.run(
        [
            "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
            "-in", str(archive),
            "-out", str(plaintext_tar),
            "-pass", "pass:roundtrip-pass",
        ],
        check=True,
    )
    subprocess.run(
        ["tar", "-xzf", str(plaintext_tar), "-C", str(out)],
        check=True,
    )

    # Original leads.db survives intact.
    restored = (out / "demo-leads" / "leads.db").read_text()
    assert restored == "FAKE LEAD DATA"


def test_provision_destroy_no_archive_keeps_profile(monkeypatch, workspace):
    """With --no-archive the profile is NOT wiped (we don't lose data)."""
    leadai = _import_leadai(monkeypatch, workspace)

    from typer.testing import CliRunner
    runner = CliRunner()

    result = runner.invoke(
        leadai.app,
        [
            "provision-destroy", workspace["slug"], "--force",
            "--no-archive",
        ],
    )
    assert result.exit_code == 0, result.stdout

    # No backups created.
    assert list(workspace["backups"].glob("*")) == []
    # Profile directory still there.
    assert workspace["profile_dir"].exists()
    # Tenant still suspended.
    data = json.loads(workspace["tenants_file"].read_text())
    assert data["tenants"][0]["status"] == "suspended"


def test_provision_destroy_missing_tenant_fails(monkeypatch, workspace):
    leadai = _import_leadai(monkeypatch, workspace)
    from typer.testing import CliRunner
    runner = CliRunner()

    result = runner.invoke(
        leadai.app,
        ["provision-destroy", "does-not-exist", "--force"],
    )
    assert result.exit_code == 1
    assert "not found" in result.stdout.lower()
