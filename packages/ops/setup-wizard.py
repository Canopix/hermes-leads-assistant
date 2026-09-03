#!/usr/bin/env python3
"""setup-wizard — Interactive setup wizard for Hermes Leads Assistant.

Uses Typer + Rich + questionary for a beautiful CLI experience.

Usage:
    python packages/ops/setup-wizard.py
    # or via the wrapper:
    ./packages/ops/setup-wizard.sh
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

try:
    import questionary
    import typer
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
except ImportError:
    print("Missing dependencies. Install them with:")
    print("  pip install typer rich questionary")
    print("")
    print("Or if using the Hermes venv:")
    print("  ~/.hermes/hermes-agent/venv/bin/pip install typer rich questionary")
    sys.exit(1)

# ─── Setup ────────────────────────────────────────────────────────────
app = typer.Typer(
    name="setup-wizard",
    help="Interactive setup wizard for Hermes Leads Assistant.",
    no_args_is_help=False,
    add_completion=False,
)
console = Console()

MONOREPO_ROOT = Path(__file__).resolve().parent.parent.parent
OPS_DIR = Path(__file__).resolve().parent
PROVISION_SCRIPT = OPS_DIR / "provision-client.sh"
TENANTS_FILE = MONOREPO_ROOT / "tenants.json"
TOTAL_STEPS = 7


# ─── Helpers ──────────────────────────────────────────────────────────
def slugify(name: str) -> str:
    """Generate a URL-friendly slug from a business name."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug[:20]


def validate_token(token: str) -> bool:
    """Validate Telegram bot token format (123456:ABC-DEF)."""
    return bool(re.match(r"^\d+:[A-Za-z0-9_-]+$", token))


def validate_numeric_id(id_str: str) -> bool:
    """Validate that a string is a numeric ID."""
    return bool(re.match(r"^\d+$", id_str))


def ok(msg: str) -> None:
    """Print a success message."""
    console.print(f"  [green]:heavy_check_mark:[/green] {msg}")


def warn(msg: str) -> None:
    """Print a warning message."""
    console.print(f"  [yellow]:warning:[/yellow] {msg}")


def fail(msg: str) -> None:
    """Print an error message."""
    console.print(f"  [red]:cross_mark:[/red] {msg}")


def info(msg: str) -> None:
    """Print an info message."""
    console.print(f"  [dim]:info:[/dim] {msg}")


def divider() -> None:
    """Print a divider line."""
    console.print("  [dim]-------------------------------------------[/dim]")


def step_header(step: int, title: str) -> None:
    """Print a step header with divider lines."""
    console.print()
    console.print(
        Panel(
            f"[bold]Step {step}/{TOTAL_STEPS}[/bold]  {title}",
            style="blue",
            border_style="blue",
            expand=False,
        )
    )


def print_banner() -> None:
    """Print the welcome banner."""
    banner_text = Text()
    banner_text.append("Hermes Leads Assistant", style="bold cyan")
    banner_text.append("  .  ", style="dim")
    banner_text.append("Setup Wizard", style="bold")
    banner_text.append("  ", style="dim")
    banner_text.append("v1.0.0", style="dim")

    console.print()
    console.print(
        Panel(banner_text, border_style="cyan", padding=(0, 2))
    )
    console.print()


def prompt_input(
    message: str,
    default: str | None = None,
    validate: callable | None = None,
    error_msg: str = "Invalid input",
) -> str:
    """Prompt for text input with optional default and validation."""
    while True:
        result = questionary.text(
            message,
            default=default or "",
        ).ask()

        if result is None:
            console.print("\n[yellow]Cancelled.[/yellow]")
            raise typer.Abort()

        result = result.strip()

        if not result and default is not None:
            return default

        if not result:
            fail("This field is required.")
            continue

        if validate and not validate(result):
            fail(error_msg)
            continue

        return result


def prompt_input_optional(
    message: str,
    validate: callable | None = None,
    error_msg: str = "Invalid input",
) -> str:
    """Prompt for text input; empty Enter skips the field."""
    while True:
        result = questionary.text(
            message,
            default="",
        ).ask()

        if result is None:
            console.print("\n[yellow]Cancelled.[/yellow]")
            raise typer.Abort()

        result = result.strip()

        if not result:
            return ""

        if validate and not validate(result):
            fail(error_msg)
            continue

        return result


def prompt_password(message: str) -> str:
    """Prompt for a password (masked input)."""
    result = questionary.password(message).ask()
    if result is None:
        console.print("\n[yellow]Cancelled.[/yellow]")
        raise typer.Abort()
    return result.strip()


def prompt_confirm(message: str, default: bool = True) -> bool:
    """Prompt for a yes/no confirmation."""
    result = questionary.confirm(message, default=default).ask()
    if result is None:
        console.print("\n[yellow]Cancelled.[/yellow]")
        raise typer.Abort()
    return result


def prompt_select(message: str, choices: list[str], default: str | None = None) -> str:
    """Prompt for a single selection from a list."""
    result = questionary.select(
        message,
        choices=choices,
        default=default,
    ).ask()
    if result is None:
        console.print("\n[yellow]Cancelled.[/yellow]")
        raise typer.Abort()
    return result


# ─── Preflight ────────────────────────────────────────────────────────
def preflight() -> None:
    """Check that Hermes Agent is installed."""
    hermes_cmd = shutil.which("hermes")
    if not hermes_cmd:
        fail("Hermes Agent not found in PATH")
        console.print()
        console.print("  Install it first:")
        console.print("  [cyan]curl -fsSL https://get.hermes.bot | bash[/cyan]")
        console.print()
        raise typer.Exit(1)

    try:
        result = subprocess.run(
            ["hermes", "--version"],
            capture_output=True, text=True, timeout=5,
        )
        version = result.stdout.strip().split("\n")[0] if result.stdout else "unknown"
    except Exception:
        version = "unknown"

    ok(f"Hermes Agent: {version}")
    console.print()


# ─── Step 1: Business info ───────────────────────────────────────────
def step_business_info() -> tuple[str, str]:
    """Get business name and generate slug."""
    step_header(1, "Business information")

    console.print("  [dim]The name of the business that will use the capture bot.[/dim]")
    console.print()

    client_name = prompt_input(
        "Business name",
        validate=lambda x: len(x) >= 2,
        error_msg="Name too short (minimum 2 characters)",
    )

    auto_slug = slugify(client_name)
    slug = prompt_input(
        "Profile slug",
        default=auto_slug,
        validate=lambda x: re.match(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", x) is not None,
        error_msg="Invalid slug. Only lowercase letters, numbers, and hyphens.",
    )

    ok(f"Business: {client_name}")
    ok(f"Profile: {slug}-leads")
    console.print()

    return client_name, slug


# ─── Step 2: Channels ────────────────────────────────────────────────
def step_channels() -> dict:
    """Configure communication channels (Telegram, WhatsApp, or both)."""
    step_header(2, "Communication channels")

    console.print("  [dim]How will leads reach the bot?[/dim]")
    console.print()

    channel = prompt_select(
        "Primary channel",
        choices=[
            "Telegram (public bot)",
            "WhatsApp (Kapso)",
            "Both (Telegram + WhatsApp)",
        ],
    )

    config = {
        "telegram": False,
        "kapso": False,
        "telegram_token": "",
        "owner_telegram_id": "",
        "kapso_api_key": "",
        "kapso_phone_number_id": "",
        "kapso_funnel_url": "",
        "kapso_port": "",
        "kapso_allow_all": False,
    }

    if "Telegram" in channel:
        config["telegram"] = True
        console.print()
        console.print("  [dim]Create a bot with @BotFather on Telegram: /newbot[/dim]")
        console.print()

        config["telegram_token"] = prompt_input(
            "Telegram bot token (123456:ABC-DEF...)",
            validate=validate_token,
            error_msg="Invalid format. Must be: 123456:ABC-DEF...",
        )

    if "WhatsApp" in channel:
        config["kapso"] = True
        console.print()
        console.print("  [dim]Kapso configuration for WhatsApp.[/dim]")
        console.print("  [dim]Docs: https://docs.kapso.ai/docs/whatsapp/hermes-agent[/dim]")
        console.print()

        config["kapso_api_key"] = prompt_password("Kapso API key")

        console.print("  [dim]Optional: configure them now or later with 'hermes kapso setup'[/dim]")
        console.print()

        phone_id = prompt_input(
            "Kapso phone number ID (leave empty to configure later)",
            default="",
            validate=lambda x: True,
            error_msg="",
        )
        config["kapso_phone_number_id"] = phone_id

        funnel_url = prompt_input(
            "Public webhook URL (https://host/inbound/acme/kapso) (leave empty to configure later)",
            default="",
            validate=lambda x: not x or x.startswith("https://"),
            error_msg="Must be a valid HTTPS URL.",
        )
        config["kapso_funnel_url"] = funnel_url

        config["kapso_allow_all"] = prompt_confirm(
            "Allow all WhatsApp users? (dev/pilot only)",
            default=False,
        )

    console.print()
    ok("Channels configured")
    console.print()

    return config


# ─── Step 3: Owner ID (optional) ─────────────────────────────────────
def step_owner_id(channels: dict) -> str:
    """Get the owner ID for admin commands (optional — skip for lead-only testing)."""
    step_header(3, "Bot administrator (optional)")

    console.print("  [dim]The owner can use the bot's admin commands on Telegram/WhatsApp.[/dim]")
    console.print("  [dim]Leads don't see them. Leave empty to test only as an end user.[/dim]")
    console.print("  [dim]Your numeric ID: message @userinfobot on Telegram.[/dim]")
    console.print()

    if channels.get("telegram"):
        owner_id = prompt_input_optional(
            "Owner's Telegram user ID (Enter to skip)",
            validate=lambda x: validate_numeric_id(x),
            error_msg="The ID must be numeric. Get it from @userinfobot.",
        )
        if owner_id:
            ok(f"Owner Telegram: {owner_id}")
        else:
            warn("No owner — everyone joins as a lead (no admin commands)")
        console.print()
        return owner_id

    if channels.get("kapso") and not channels.get("telegram"):
        console.print("  [dim]Business owner's WhatsApp ID (E.164 format).[/dim]")
        console.print("  [dim]Example: 5491112345678 — Enter to skip[/dim]")
        console.print()

        owner_id = prompt_input_optional(
            "Owner WhatsApp ID (Enter to skip)",
            validate=lambda x: len(x) >= 8 and x.replace("+", "").isdigit(),
            error_msg="Invalid format. Use E.164: 5491112345678",
        )
        if owner_id:
            ok(f"Owner WhatsApp: {owner_id}")
        else:
            warn("No WhatsApp owner configured")
        console.print()
        return owner_id

    console.print()
    return ""


# ─── Step 4: LLM provider ───────────────────────────────────────────
def step_llm_provider() -> tuple[str, str, str]:
    """Configure the LLM provider."""
    step_header(4, "LLM provider")

    console.print("  [dim]The model the bot will use to answer inquiries.[/dim]")
    console.print()

    provider = prompt_select(
        "Provider",
        choices=[
            "OpenAI (recommended - gpt-4o-mini)",
            "OpenRouter (access to many models)",
            "Custom (OpenAI-compatible endpoint)",
        ],
    )

    if provider.startswith("Custom"):
        model_provider = "custom"
        base_url = prompt_input(
            "Endpoint URL (e.g. http://localhost:11434/v1)",
            validate=lambda x: x.startswith("http://") or x.startswith("https://"),
            error_msg="Must be a valid URL (http:// or https://)",
        )
        model_name = prompt_input(
            "Model name (e.g. qwen3.6)",
            validate=lambda x: len(x) > 0,
            error_msg="Model is required.",
        )
    elif provider.startswith("OpenRouter"):
        model_provider = "openrouter"
        base_url = ""
        model_name = "openai/gpt-4o-mini"
    else:
        model_provider = "openai"
        base_url = ""
        model_name = "gpt-4o-mini"

    console.print()
    api_key = prompt_password("LLM API key")

    # For openai/openrouter, let user override model
    if model_provider != "custom":
        model_name = prompt_input("Model", default=model_name)

    console.print()
    ok(f"LLM: {model_provider}/{model_name}")

    return model_provider, model_name, api_key, base_url


# ─── Step 5: Mem0 ────────────────────────────────────────────────────
def step_mem0() -> str:
    """Configure Mem0 for per-lead memory."""
    step_header(5, "Per-lead memory (Mem0)")

    console.print("  [dim]Mem0 stores conversations per lead.[/dim]")
    console.print("  [dim]Each lead gets its own isolated memory.[/dim]")
    console.print("  [dim]Get your API key at: https://mem0.ai[/dim]")
    console.print()

    use_mem0 = prompt_confirm("Do you want to use Mem0 for per-lead memory?", default=True)

    if use_mem0:
        api_key = prompt_password("Mem0 API key")
        ok("Mem0 enabled")
        console.print()
        return api_key
    else:
        warn("Mem0 disabled - the bot won't remember conversations")
        console.print()
        return ""


# ─── Step 6: RAG ─────────────────────────────────────────────────────
def step_rag() -> dict:
    """Configure RAG embeddings."""
    step_header(6, "Knowledge base (RAG)")

    console.print("  [dim]The bot uses embeddings to search your knowledge base for answers.[/dim]")
    console.print("  [dim]You need an OpenAI-compatible endpoint (/v1/embeddings)[/dim]")
    console.print()

    use_rag = prompt_confirm("Do you want to enable RAG with embeddings?", default=True)

    if use_rag:
        base_url = prompt_input(
            "Endpoint base URL",
            default="https://api.openai.com/v1",
        )
        model = prompt_input(
            "Embeddings model",
            default="text-embedding-3-small",
        )

        if base_url == "https://api.openai.com/v1":
            info("Using the same LLM API key for embeddings")
            console.print()
            return {
                "use": True,
                "api_key": "",
                "base_url": base_url,
                "model": model,
            }
        else:
            api_key = prompt_password("Embeddings API key")
            console.print()
            return {
                "use": True,
                "api_key": api_key,
                "base_url": base_url,
                "model": model,
            }
    else:
        warn("RAG disabled - the bot will only use static FAQs")
        console.print()
        return {"use": False, "api_key": "", "base_url": "", "model": ""}


# ─── Step 7: Knowledge base ──────────────────────────────────────────
def step_knowledge(slug: str) -> str:
    """Configure knowledge base files."""
    step_header(7, "Knowledge base")

    console.print("  [dim]Business documents (.md, .txt, .json, .csv, .html)[/dim]")
    console.print("  [dim]The bot will use this info to answer lead inquiries.[/dim]")
    console.print()

    knowledge_dir = MONOREPO_ROOT / "examples" / slug / "knowledge"
    knowledge_src = ""

    if knowledge_dir.exists():
        info(f"A KB already exists at examples/{slug}/knowledge/")
        if prompt_confirm("Use that knowledge base?", default=True):
            knowledge_src = str(knowledge_dir)

    if not knowledge_src:
        use_custom = prompt_confirm("Do you have knowledge base files to copy?", default=False)
        if use_custom:
            while True:
                path = prompt_input("Path to the knowledge folder")
                path = str(Path(path).expanduser())
                if Path(path).is_dir():
                    knowledge_src = path
                    break
                else:
                    fail(f"Folder does not exist: {path}")
        else:
            info(f"You can add docs later at: ~/.hermes/profiles/{slug}-leads/knowledge/")

    if knowledge_src:
        count = sum(
            1
            for f in Path(knowledge_src).rglob("*")
            if f.is_file() and f.suffix.lower() in {".md", ".txt", ".json", ".csv", ".html"}
        )
        ok(f"Knowledge base: {count} files to index")

    console.print()
    return knowledge_src


# ─── Confirmation ─────────────────────────────────────────────────────
def step_confirm(
    client_name: str,
    slug: str,
    channels: dict,
    llm: tuple[str, str, str, str],
    mem0_key: str,
    rag: dict,
    knowledge_src: str,
) -> bool:
    """Show summary and ask for confirmation."""
    step_header(TOTAL_STEPS, "Confirmation")

    model_provider, model_name, _, base_url = llm

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("Field", style="dim")
    table.add_column("Value", style="bold")

    table.add_row("Business", client_name)
    table.add_row("Profile", f"{slug}-leads")

    channels_list = []
    if channels.get("telegram"):
        channels_list.append("Telegram")
    if channels.get("kapso"):
        channels_list.append("WhatsApp")
    table.add_row("Channels", " + ".join(channels_list) if channels_list else "None")

    if channels.get("owner_telegram_id"):
        table.add_row("Owner Telegram", channels["owner_telegram_id"])

    table.add_row("LLM", f"{model_provider}/{model_name}")
    table.add_row("Mem0", "enabled" if mem0_key else "disabled")
    table.add_row("RAG", f"enabled ({rag['model']})" if rag["use"] else "disabled")
    table.add_row("Knowledge", knowledge_src if knowledge_src else "no files")

    console.print()
    console.print(table)
    console.print()

    return prompt_confirm("Proceed with the installation?", default=True)


# ─── Tenant registry ─────────────────────────────────────────────────
def register_tenant(client_name: str, slug: str, channels: dict) -> None:
    """Register client in tenants.json (same catalog as leadai CLI)."""
    channel_list: list[str] = []
    if channels.get("telegram"):
        channel_list.append("telegram")
    if channels.get("kapso"):
        channel_list.append("whatsapp")

    if TENANTS_FILE.exists():
        data = json.loads(TENANTS_FILE.read_text())
    else:
        data = {"tenants": []}

    now = datetime.now(UTC).isoformat()
    for tenant in data["tenants"]:
        if tenant["slug"] == slug:
            tenant["name"] = client_name
            tenant["hermes_profile"] = f"{slug}-leads"
            tenant["status"] = "active"
            tenant["channels"] = channel_list or tenant.get("channels", [])
            tenant["updated_at"] = now
            TENANTS_FILE.write_text(json.dumps(data, indent=2) + "\n")
            ok(f"Tenant updated in tenants.json ({slug})")
            return

    data["tenants"].append(
        {
            "slug": slug,
            "name": client_name,
            "hermes_profile": f"{slug}-leads",
            "status": "active",
            "channels": channel_list or ["telegram"],
            "created_at": now,
            "updated_at": now,
        }
    )
    TENANTS_FILE.write_text(json.dumps(data, indent=2) + "\n")
    ok(f"Tenant registered in tenants.json ({slug})")


# ─── Execute provisioning ────────────────────────────────────────────
def execute_provision(
    client_name: str,
    slug: str,
    channels: dict,
    llm: tuple[str, str, str, str],
    mem0_key: str,
    rag: dict,
    knowledge_src: str,
) -> None:
    """Build args and call provision-client.sh."""
    model_provider, model_name, api_key, base_url = llm

    console.print()
    console.print(
        Panel("[bold]Running provision...[/bold]", style="blue", border_style="blue")
    )
    console.print()

    args = [
        "bash",
        str(PROVISION_SCRIPT),
        "--slug", slug,
        "--name", client_name,
        "--model-provider", model_provider,
        "--model", model_name,
        "--openai-api-key", api_key,
    ]

    if base_url:
        args.extend(["--model-base-url", base_url])

    # Telegram
    if channels.get("telegram") and channels.get("telegram_token"):
        args.extend(["--telegram-token", channels["telegram_token"]])
    if channels.get("owner_telegram_id"):
        args.extend(["--owner-telegram-id", channels["owner_telegram_id"]])

    # Kapso
    if channels.get("kapso") and channels.get("kapso_api_key"):
        args.extend(["--kapso-api-key", channels["kapso_api_key"]])
        if channels.get("kapso_phone_number_id"):
            args.extend(["--kapso-phone-number-id", channels["kapso_phone_number_id"]])
        if channels.get("kapso_funnel_url"):
            args.extend(["--kapso-funnel-url", channels["kapso_funnel_url"]])
        if channels.get("kapso_allow_all"):
            args.append("--kapso-allow-all")

    # Mem0
    if mem0_key:
        args.extend(["--mem0-key", mem0_key])

    # RAG
    if rag["use"]:
        if rag["api_key"]:
            args.extend(["--embedding-api-key", rag["api_key"]])
        else:
            args.extend(["--embedding-api-key", api_key])
        args.extend(["--embedding-base-url", rag["base_url"]])
        args.extend(["--embedding-model", rag["model"]])

    # Knowledge
    if knowledge_src:
        args.extend(["--client-knowledge", knowledge_src])

    info(f"Provision: {PROVISION_SCRIPT.name}")
    console.print()

    result = subprocess.run(args)

    if result.returncode == 0:
        console.print()
        ok(f"Profile {slug}-leads created successfully")
    else:
        console.print()
        fail("Error during provisioning")
        info(f"Check the logs: ~/.hermes/profiles/{slug}-leads/logs/errors.log")
        raise typer.Exit(1)


# ─── Post-install summary ────────────────────────────────────────────
def print_summary(slug: str) -> None:
    """Print post-install instructions."""
    console.print()
    console.print(
        Panel("[bold green]Installation complete![/bold green]", style="green", border_style="green")
    )
    console.print()
    console.print("  [bold]Your bot is ready. Try it:[/bold]")
    console.print()
    console.print("  [cyan]# Check the gateway[/cyan]")
    console.print(f"  {slug}-leads gateway status")
    console.print()
    console.print("  [cyan]# Test on Telegram (message your bot)[/cyan]")
    console.print(f"  {slug}-leads sessions list")
    console.print()
    console.print("  [cyan]# Search the knowledge base[/cyan]")
    console.print(f'  {slug}-leads lead-rag search "your question"')
    console.print()
    console.print("  [cyan]# Open the Kanban dashboard[/cyan]")
    console.print(f"  {slug}-leads dashboard")
    console.print("  [dim]-> http://127.0.0.1:9119[/dim]")
    console.print()
    console.print("  [cyan]# Verify the configuration[/cyan]")
    console.print(f"  bash {OPS_DIR}/validate-pilot.sh {slug}-leads")
    console.print()
    console.print("  [dim]Paths:[/dim]")
    console.print(f"    [dim]Profile:   ~/.hermes/profiles/{slug}-leads/[/dim]")
    console.print(f"    [dim]Config:    ~/.hermes/profiles/{slug}-leads/config.yaml[/dim]")
    console.print(f"    [dim]Secrets:   ~/.hermes/profiles/{slug}-leads/.env[/dim]")
    console.print(f"    [dim]Knowledge: ~/.hermes/profiles/{slug}-leads/knowledge/[/dim]")
    console.print()

    if prompt_confirm("Do you want to verify the installation now (validate-pilot)?", default=True):
        console.print()
        console.print(
            Panel("[bold]Running smoke tests...[/bold]", style="blue", border_style="blue")
        )
        console.print()
        result = subprocess.run(
            ["bash", str(OPS_DIR / "validate-pilot.sh"), f"{slug}-leads"]
        )
        if result.returncode == 0:
            console.print()
            ok("All tests passed")
        else:
            console.print()
            warn("Some tests failed - check the output above")

    console.print()
    info("To add another client/tenant later: ./packages/ops/setup-wizard.sh")
    console.print()


# ─── Main ────────────────────────────────────────────────────────────
@app.command()
def main(
    skip_preflight: bool = typer.Option(
        False, "--skip-preflight", help="Skip Hermes installation check"
    ),
) -> None:
    """Hermes Leads Assistant — Setup Wizard.

    Interactively configure a new client profile with channels,
    LLM, memory, and knowledge base.
    """
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        console.print("[red]This wizard is interactive.[/red]")
        console.print()
        console.print("Use provision-client.sh for non-interactive mode:")
        console.print('  bash packages/ops/provision-client.sh --slug SLUG --name "NAME" [options]')
        raise typer.Exit(1)

    print_banner()
    info("Installation wizard for Hermes Leads Assistant")
    info("We'll guide you step by step to configure your bot.")
    console.print()
    divider()
    console.print()

    if not skip_preflight:
        preflight()

    # Step 1: Business info
    client_name, slug = step_business_info()

    # Step 2: Channels
    channels = step_channels()

    # Step 3: Owner ID
    owner_id = step_owner_id(channels)
    if owner_id:
        channels["owner_telegram_id"] = owner_id

    # Step 4: LLM
    llm = step_llm_provider()

    # Step 5: Mem0
    mem0_key = step_mem0()

    # Step 6: RAG
    rag = step_rag()

    # Step 7: Knowledge base
    knowledge_src = step_knowledge(slug)

    # Confirm & execute
    confirmed = step_confirm(client_name, slug, channels, llm, mem0_key, rag, knowledge_src)
    if not confirmed:
        warn("Installation cancelled")
        raise typer.Abort()

    register_tenant(client_name, slug, channels)
    execute_provision(client_name, slug, channels, llm, mem0_key, rag, knowledge_src)
    print_summary(slug)


if __name__ == "__main__":
    app()
