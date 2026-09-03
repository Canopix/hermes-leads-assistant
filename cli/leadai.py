#!/usr/bin/env python3
"""
Hermes Leads Assistant - Multi-Tenant CLI
Manage client/tenant bots, provisioning, and monitoring.
"""

import contextlib
import json
import os
import secrets
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(
    name="leadai",
    help="Hermes Leads Assistant - Multi-Tenant Bot Management",
    no_args_is_help=True
)
console = Console()

# Config
TENANTS_FILE = Path(__file__).parent.parent / "tenants.json"
HERMES_PROFILES_DIR = Path.home() / ".hermes" / "profiles"


def load_tenants() -> dict:
    """Load the tenant registry from tenants.json"""
    if not TENANTS_FILE.exists():
        return {"tenants": []}
    with open(TENANTS_FILE) as f:
        return json.load(f)


def save_tenants(data: dict):
    """Save the tenant registry to tenants.json"""
    with open(TENANTS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_tenant(slug: str) -> dict | None:
    """Get a tenant by its slug"""
    data = load_tenants()
    for tenant in data["tenants"]:
        if tenant["slug"] == slug:
            return tenant
    return None


# ============================================================
# COMMANDS: TENANTS
# ============================================================

@app.command()
def tenants_list():
    """List all registered tenants"""
    data = load_tenants()

    if not data["tenants"]:
        console.print("[yellow]No tenants registered[/yellow]")
        return

    table = Table(title="Registered Tenants")
    table.add_column("Slug", style="cyan")
    table.add_column("Name", style="green")
    table.add_column("Status", style="bold")
    table.add_column("Channels")
    table.add_column("Created")

    for tenant in data["tenants"]:
        status_style = {
            "active": "[green]Active[/green]",
            "inactive": "[red]Inactive[/red]",
            "suspended": "[yellow]Suspended[/yellow]"
        }.get(tenant["status"], tenant["status"])

        channels = ", ".join(tenant.get("channels", []))

        table.add_row(
            tenant["slug"],
            tenant["name"],
            status_style,
            channels,
            tenant.get("created_at", "N/A")
        )

    console.print(table)


@app.command()
def tenants_add(
    slug: str = typer.Option(..., prompt=True, help="Tenant slug (e.g. agencia-autos)"),
    name: str = typer.Option(..., prompt=True, help="Tenant name"),
    channels: str = typer.Option("telegram", help="Comma-separated channels (telegram,whatsapp)")
):
    """Add a new tenant"""
    data = load_tenants()

    # Check that it doesn't already exist
    for tenant in data["tenants"]:
        if tenant["slug"] == slug:
            console.print(f"[red]Error: a tenant with slug '{slug}' already exists[/red]")
            raise typer.Exit(1)

    from datetime import datetime

    new_tenant = {
        "slug": slug,
        "name": name,
        "hermes_profile": f"{slug}-leads",
        "status": "active",
        "channels": [c.strip() for c in channels.split(",")],
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat()
    }

    data["tenants"].append(new_tenant)
    save_tenants(data)

    console.print(f"[green]Tenant '{name}' ({slug}) created successfully[/green]")


@app.command()
def tenants_show(
    slug: str = typer.Argument(..., help="Slug of the tenant to show")
):
    """Show details of a tenant"""
    tenant = get_tenant(slug)

    if not tenant:
        console.print(f"[red]Tenant '{slug}' not found[/red]")
        raise typer.Exit(1)

    console.print(f"\n[bold cyan]Tenant: {tenant['name']}[/bold cyan]")
    console.print(f"  Slug: {tenant['slug']}")
    console.print(f"  Hermes profile: {tenant['hermes_profile']}")
    console.print(f"  Status: {tenant['status']}")
    console.print(f"  Channels: {', '.join(tenant.get('channels', []))}")
    console.print(f"  Created: {tenant.get('created_at', 'N/A')}")

    if tenant.get("owner_telegram_id"):
        console.print(f"  Owner Telegram: {tenant['owner_telegram_id']}")
    if tenant.get("owner_whatsapp_id"):
        console.print(f"  Owner WhatsApp: {tenant['owner_whatsapp_id']}")

    # Check whether the Hermes profile exists
    profile_dir = HERMES_PROFILES_DIR / tenant["hermes_profile"]
    if profile_dir.exists():
        console.print("  [green]Hermes profile: exists[/green]")
    else:
        console.print("  [red]Hermes profile: not found[/red]")


@app.command()
def tenants_remove(
    slug: str = typer.Argument(..., help="Slug of the tenant to remove"),
    force: bool = typer.Option(False, "--force", "-f", help="Delete without confirmation")
):
    """Remove a tenant"""
    data = load_tenants()

    tenant_to_remove = None
    for _i, tenant in enumerate(data["tenants"]):
        if tenant["slug"] == slug:
            tenant_to_remove = tenant
            break

    if not tenant_to_remove:
        console.print(f"[red]Tenant '{slug}' not found[/red]")
        raise typer.Exit(1)

    if not force:
        confirm = typer.confirm(f"Delete tenant '{tenant_to_remove['name']}' ({slug})?")
        if not confirm:
            console.print("[yellow]Operation cancelled[/yellow]")
            raise typer.Exit(0)

    data["tenants"].remove(tenant_to_remove)
    save_tenants(data)

    console.print(f"[green]Tenant '{slug}' removed[/green]")


# ============================================================
# COMMANDS: PROVISION
# ============================================================

@app.command()
def provision_create(
    slug: str = typer.Argument(..., help="Slug of the tenant to provision"),
    telegram_token: str = typer.Option(None, help="Telegram bot token"),
    kapso_api_key: str = typer.Option(None, help="Kapso API key (WhatsApp)"),
    kapso_phone_number_id: str = typer.Option(None, help="Kapso phone number ID"),
    owner_telegram: str = typer.Option(None, help="Owner's Telegram ID"),
    owner_whatsapp: str = typer.Option(None, help="Owner's WhatsApp ID")
):
    """Provision a new client/tenant (runs provision-client.sh)"""
    tenant = get_tenant(slug)

    if not tenant:
        console.print(f"[red]Tenant '{slug}' not found. Create it first with 'tenants add'[/red]")
        raise typer.Exit(1)

    script_path = Path(__file__).parent.parent / "packages" / "ops" / "provision-client.sh"

    if not script_path.exists():
        console.print(f"[red]Provisioning script not found: {script_path}[/red]")
        raise typer.Exit(1)

    cmd = ["bash", str(script_path), "--slug", slug, "--name", tenant["name"]]

    # Secrets are passed via the child env, NOT as argv. provision-client.sh
    # reads LEADAI_* env vars when the matching flag is omitted. This keeps
    # tokens out of `ps`, `/proc/<pid>/cmdline`, and shell history.
    child_env = {**os.environ}
    if telegram_token:
        child_env["LEADAI_TELEGRAM_TOKEN"] = telegram_token
    if kapso_api_key:
        child_env["LEADAI_KAPSO_API_KEY"] = kapso_api_key
    if kapso_phone_number_id:
        cmd.extend(["--kapso-phone-number-id", kapso_phone_number_id])
    if owner_telegram:
        cmd.extend(["--owner-telegram-id", owner_telegram])
    if owner_whatsapp:
        cmd.extend(["--owner-whatsapp", owner_whatsapp])

    console.print(f"[cyan]Provisioning tenant '{slug}'...[/cyan]")

    result = subprocess.run(cmd, capture_output=True, text=True, env=child_env)

    if result.returncode == 0:
        console.print(f"[green]Tenant '{slug}' provisioned successfully[/green]")
        console.print(result.stdout)
    else:
        console.print(f"[red]Error provisioning tenant '{slug}'[/red]")
        console.print(result.stderr)
        raise typer.Exit(1)


@app.command()
def provision_destroy(
    slug: str = typer.Argument(..., help="Slug of the tenant to deprovision"),
    force: bool = typer.Option(False, "--force", "-f", help="Delete without confirmation"),
    archive: bool = typer.Option(
        True,
        "--archive/--no-archive",
        help="Create a tar.gz.enc backup before deleting the profile (recommended).",
    ),
    archive_dir: str = typer.Option(
        None,
        "--archive-dir",
        help="Base directory for backups. Default: ~/backups.",
    ),
    archive_pass: str = typer.Option(
        None,
        "--archive-pass",
        envvar="LEADAI_ARCHIVE_PASS",
        help="OpenSSL password for the backup. If not provided, one is generated and shown.",
    ),
    wipe_profile: bool = typer.Option(
        True,
        "--wipe-profile/--keep-profile",
        help="Delete the Hermes profile after the backup. Default: delete.",
    ),
):
    """Deprovision a client/tenant: stop the bot, archive the profile
    (encrypted tar.gz), and mark the tenant as 'suspended' (does NOT
    delete the registry entry)."""
    tenant = get_tenant(slug)
    if not tenant:
        console.print(f"[red]Tenant '{slug}' not found[/red]")
        raise typer.Exit(1)

    if not force:
        confirm = typer.confirm(
            f"Deprovision tenant '{tenant['name']}' ({slug})? "
            "This will stop the bot and remove the on-disk profile."
        )
        if not confirm:
            console.print("[yellow]Operation cancelled[/yellow]")
            raise typer.Exit(0)

    # 1. Stop the bot first so no new leads arrive mid-archive.
    console.print(f"[cyan]Stopping bot for '{slug}'...[/cyan]")
    with contextlib.suppress(SystemExit):
        bot_stop(slug)
        # bot_stop may call typer.Exit if already stopped; that's fine here.

    profile_name = tenant.get("hermes_profile") or f"{slug}-leads"
    profile_path = HERMES_PROFILES_DIR / profile_name

    if not profile_path.exists():
        console.print(
            f"[yellow]On-disk profile not found: {profile_path} "
            "(marking tenant as suspended without backup).[/yellow]"
        )
    elif archive:
        # 2. Encrypted tar.gz backup of the profile.
        backup_root = Path(archive_dir).expanduser() if archive_dir else (Path.home() / "backups")
        backup_root.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        tar_path = backup_root / f"{slug}-{ts}.tar.gz"
        enc_path = backup_root / f"{slug}-{ts}.tar.gz.enc"

        console.print(f"[cyan]Archiving profile → {enc_path}[/cyan]")
        # tar the profile dir
        subprocess.run(
            ["tar", "-czf", str(tar_path), "-C", str(HERMES_PROFILES_DIR), profile_name],
            check=True,
        )
        # encrypt with OpenSSL (AES-256-CBC + SHA-256 digest).Compatible with
        # `openssl enc -d -aes-256-cbc -pbkdf2 -in X -out Y` on any system.
        password = archive_pass or secrets.token_urlsafe(24)
        subprocess.run(
            [
                "openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt",
                "-in", str(tar_path),
                "-out", str(enc_path),
                "-pass", f"pass:{password}",
            ],
            check=True,
        )
        # Best-effort: shred the plaintext tar so it's not recoverable.
        try:
            subprocess.run(["shred", "-u", str(tar_path)], check=False)
        except FileNotFoundError:
            tar_path.unlink(missing_ok=True)

        # Restrict perms on the encrypted archive.
        with contextlib.suppress(OSError):
            enc_path.chmod(0o600)

        if not archive_pass:
            console.print(
                f"[bold yellow]Save this password — without it the backup "
                f"is unusable:[/bold yellow]\n  {password}"
            )
        console.print(f"[green]Backup created: {enc_path}[/green]")

        if wipe_profile:
            console.print(f"[cyan]Deleting on-disk profile: {profile_path}[/cyan]")
            shutil.rmtree(profile_path, ignore_errors=False)
            console.print("[green]Profile deleted.[/green]")

    # 3. Mark tenant as suspended in the registry (preserve the row so the
    # super-admin can still see it, and so members get the 403 / suspended
    # flow in the portal).
    data = load_tenants()
    for t in data["tenants"]:
        if t["slug"] == slug:
            t["status"] = "suspended"
            t["deprovisioned_at"] = datetime.now().isoformat()
            break
    save_tenants(data)

    console.print(f"[green]Tenant '{slug}' deprovisioned (status=suspended).[/green]")


# ============================================================
# COMMANDS: BOT
# ============================================================

def bot_start(slug: str):
    """Start a tenant's bot"""
    profile_name = f"{slug}-leads"

    console.print(f"[cyan]Starting bot for '{slug}'...[/cyan]")

    result = subprocess.run(
        ["hermes", "gateway", "start", "--profile", profile_name],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        console.print(f"[green]Bot for '{slug}' started[/green]")
    else:
        console.print(f"[red]Error starting bot for '{slug}'[/red]")
        console.print(result.stderr)

    return result.returncode


def bot_stop(slug: str):
    """Stop a tenant's bot"""
    profile_name = f"{slug}-leads"

    console.print(f"[cyan]Stopping bot for '{slug}'...[/cyan]")

    result = subprocess.run(
        ["hermes", "gateway", "stop", "--profile", profile_name],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        console.print(f"[green]Bot for '{slug}' stopped[/green]")
    else:
        console.print(f"[red]Error stopping bot for '{slug}'[/red]")
        console.print(result.stderr)

    return result.returncode


@app.command("bot-start")
def bot_start_cmd(
    slug: str = typer.Argument(..., help="Tenant slug")
):
    """Start a tenant's bot"""
    bot_start(slug)


@app.command("bot-stop")
def bot_stop_cmd(
    slug: str = typer.Argument(..., help="Tenant slug")
):
    """Stop a tenant's bot"""
    bot_stop(slug)


@app.command("bot-restart")
def bot_restart(
    slug: str = typer.Argument(..., help="Tenant slug")
):
    """Restart a tenant's bot"""
    bot_stop(slug)
    bot_start(slug)


@app.command("bot-status")
def bot_status(
    slug: str = typer.Argument(None, help="Tenant slug (optional, shows all if omitted)")
):
    """Show the status of bots"""
    data = load_tenants()

    tenants_to_check = data["tenants"]
    if slug:
        tenant = get_tenant(slug)
        if not tenant:
            console.print(f"[red]Tenant '{slug}' not found[/red]")
            raise typer.Exit(1)
        tenants_to_check = [tenant]

    table = Table(title="Bot Status")
    table.add_column("Tenant", style="cyan")
    table.add_column("Profile", style="green")
    table.add_column("Status", style="bold")

    for tenant in tenants_to_check:
        profile_name = tenant["hermes_profile"]

        result = subprocess.run(
            ["hermes", "gateway", "status", "--profile", profile_name],
            capture_output=True,
            text=True
        )

        status = "[green]RUNNING[/green]" if result.returncode == 0 else "[red]STOPPED[/red]"

        table.add_row(
            tenant["slug"],
            profile_name,
            status
        )

    console.print(table)


@app.command("bot-logs")
def bot_logs(
    slug: str = typer.Argument(..., help="Tenant slug"),
    lines: int = typer.Option(50, "--lines", "-n", help="Number of lines to show")
):
    """Show a bot's logs"""
    profile_name = f"{slug}-leads"
    logs_dir = HERMES_PROFILES_DIR / profile_name / "logs"

    if not logs_dir.exists():
        console.print(f"[red]No logs found for '{slug}'[/red]")
        raise typer.Exit(1)

    # Find the most recent log file
    log_files = list(logs_dir.glob("*.log"))
    if not log_files:
        console.print(f"[red]No log files found for '{slug}'[/red]")
        raise typer.Exit(1)

    latest_log = max(log_files, key=os.path.getctime)

    console.print(f"[cyan]Logs for '{slug}' (last {lines} lines):[/cyan]")

    result = subprocess.run(
        ["tail", "-n", str(lines), str(latest_log)],
        capture_output=True,
        text=True
    )

    console.print(result.stdout)


# ============================================================
# COMMANDS: MONITOR
# ============================================================

@app.command()
def monitor_check():
    """Check the status of all bots"""
    data = load_tenants()

    if not data["tenants"]:
        console.print("[yellow]No tenants registered[/yellow]")
        return

    table = Table(title="Bot Health Check")
    table.add_column("Tenant", style="cyan")
    table.add_column("Status", style="bold")
    table.add_column("Uptime")

    running_count = 0
    stopped_count = 0

    for tenant in data["tenants"]:
        profile_name = tenant["hermes_profile"]

        result = subprocess.run(
            ["hermes", "gateway", "status", "--profile", profile_name],
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            status = "[green]RUNNING[/green]"
            running_count += 1
        else:
            status = "[red]STOPPED[/red]"
            stopped_count += 1

        table.add_row(
            tenant["slug"],
            status,
            "N/A"  # TODO: Implement uptime calculation
        )

    console.print(table)
    console.print(f"\n[bold]Summary:[/bold] {running_count} running, {stopped_count} stopped")


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    app()
