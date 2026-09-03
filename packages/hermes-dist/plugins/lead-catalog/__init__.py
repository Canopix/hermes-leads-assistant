"""lead-catalog — structured inventory (autos / inmobiliaria) with deterministic tools."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from . import schemas, seed, store, templates

logger = logging.getLogger(__name__)


def _tool_result(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _handle_catalog_search(args: dict, **_: Any) -> str:
    """Hermes tool handler — first arg is the LLM parameter dict."""
    try:
        conn = store.get_connection()
        try:
            vertical = store.get_vertical(conn)
            query = str(args.get("query") or "")
            status = args.get("status") or "available"
            limit = int(args.get("limit") or 10)
            limit = max(1, min(limit, 50))

            attrs_eq: dict[str, Any] = {}
            for key in (
                "marca",
                "modelo",
                "condicion",
                "barrio",
                "ciudad",
                "tipo",
                "operacion",
                "ambientes",
            ):
                if args.get(key) not in (None, ""):
                    attrs_eq[key] = args[key]

            items = store.search_items(
                conn,
                query=query,
                status=status,
                price_min=args.get("price_min"),
                price_max=args.get("price_max"),
                attrs_eq=attrs_eq or None,
                limit=limit * 3 if args.get("anio_min") is not None else limit,
            )

            anio_min = args.get("anio_min")
            if anio_min is not None:
                try:
                    amin = int(anio_min)
                    items = [
                        it
                        for it in items
                        if int((it.get("attrs") or {}).get("anio") or 0) >= amin
                    ]
                except (TypeError, ValueError):
                    pass
                items = items[:limit]

            results = []
            for it in items:
                results.append(
                    {
                        "id": it["id"],
                        "sku": it["sku"],
                        "title": it["title"],
                        "status": it["status"],
                        "price": store.format_price(it),
                        "price_amount": it["price_amount"],
                        "price_currency": it["price_currency"],
                        "price_kind": it["price_kind"],
                        "summary": it["summary"],
                        "attrs": it["attrs"],
                    }
                )
            return _tool_result(
                {
                    "vertical": vertical,
                    "count": len(results),
                    "items": results,
                    "hint": (
                        "Usá estos datos exactos. Si necesitás más detalle de un ítem, "
                        "llamá catalog_get con su id."
                    ),
                }
            )
        finally:
            conn.close()
    except Exception as exc:
        logger.exception("catalog_search failed")
        return _tool_result({"error": str(exc), "items": []})


def _handle_catalog_get(args: dict, **_: Any) -> str:
    try:
        conn = store.get_connection()
        try:
            item_id = str(args.get("id") or "").strip()
            sku = str(args.get("sku") or "").strip()
            item = None
            if item_id:
                item = store.get_item(conn, item_id=item_id)
            elif sku:
                item = store.get_item(conn, sku=sku)
            if not item:
                return _tool_result(
                    {"error": "ítem no encontrado", "id": item_id, "sku": sku}
                )
            return _tool_result(
                {
                    "vertical": store.get_vertical(conn),
                    "item": {
                        **item,
                        "price": store.format_price(item),
                    },
                }
            )
        finally:
            conn.close()
    except Exception as exc:
        logger.exception("catalog_get failed")
        return _tool_result({"error": str(exc)})


def export_rag(*, ingest: bool = False, home: Path | None = None) -> Path:
    conn = store.get_connection(home)
    try:
        path = store.export_rag_markdown(conn, home)
    finally:
        conn.close()
    if ingest:
        try:
            from lead_rag import ingest as rag_ingest  # type: ignore

            rag_ingest()
        except Exception:
            try:
                # Plugin package name on disk is lead-rag (hyphen) — import via path loader if needed.
                import importlib.util

                rag_dir = _hermes_home() / "plugins" / "lead-rag" / "__init__.py"
                if not rag_dir.is_file():
                    # Dist tree during monorepo ops
                    rag_dir = Path(__file__).resolve().parent.parent / "lead-rag" / "__init__.py"
                if rag_dir.is_file():
                    spec = importlib.util.spec_from_file_location("lead_rag_plugin", rag_dir)
                    if spec and spec.loader:
                        mod = importlib.util.module_from_spec(spec)
                        spec.loader.exec_module(mod)
                        mod.ingest()
            except Exception as exc:
                logger.warning("lead-catalog: RAG ingest after export failed: %s", exc)
    return path


def _hermes_home() -> Path:
    return store._hermes_home()


def seed_vertical(name: str, *, replace: bool = False, home: Path | None = None) -> int:
    """Seed demo data. name: canova-autos | inmobiliaria-demo"""
    conn = store.get_connection(home)
    try:
        if name == "canova-autos":
            store.set_vertical(conn, "autos")
            payloads = seed.CANOVA_AUTOS
        elif name in ("inmobiliaria-demo", "inmobiliaria"):
            store.set_vertical(conn, "inmobiliaria")
            payloads = seed.DEMO_INMOBILIARIA
        else:
            raise templates.TemplateError(
                f"seed desconocido: {name!r} (canova-autos | inmobiliaria-demo)"
            )

        if replace:
            conn.execute("DELETE FROM items")
            conn.commit()
        elif store.count_items(conn) > 0:
            logger.info("lead-catalog: seed skipped (catalog already has items)")
            return 0

        n = 0
        for payload in payloads:
            store.create_item(conn, payload)
            n += 1
        store.export_rag_markdown(conn, home)
        return n
    finally:
        conn.close()


def register(ctx) -> None:
    ctx.register_tool(
        name="catalog_search",
        toolset="lead_catalog",
        schema=schemas.CATALOG_SEARCH,
        handler=_handle_catalog_search,
        description=schemas.CATALOG_SEARCH["description"],
        emoji="📦",
    )
    ctx.register_tool(
        name="catalog_get",
        toolset="lead_catalog",
        schema=schemas.CATALOG_GET,
        handler=_handle_catalog_get,
        description=schemas.CATALOG_GET["description"],
        emoji="🏷️",
    )

    ctx.register_cli_command(
        name="lead-catalog",
        help="Lead catalog — structured inventory tools and RAG export",
        setup_fn=_cli_setup,
        handler_fn=_cli_handler,
        description="Manage catalog.db, seed verticals, export knowledge/catalog-generated.md",
    )


def _cli_setup(subparser: argparse.ArgumentParser) -> None:
    """Wire hermes lead-catalog <subcommand> onto Hermes argparse."""
    subs = subparser.add_subparsers(dest="catalog_command")

    init_p = subs.add_parser("init", help="Create catalog.db and set vertical")
    init_p.add_argument(
        "--vertical",
        choices=list(templates.VERTICALS),
        default="autos",
    )

    exp = subs.add_parser("export-rag", help="Write knowledge/catalog-generated.md")
    exp.add_argument(
        "--ingest",
        action="store_true",
        help="Also run lead-rag ingest after export",
    )

    seed_p = subs.add_parser("seed", help="Load demo / migration seed data")
    seed_p.add_argument(
        "name",
        choices=["canova-autos", "inmobiliaria-demo"],
        help="Seed pack",
    )
    seed_p.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing items before seeding",
    )

    search_p = subs.add_parser("search", help="CLI search (debug)")
    search_p.add_argument("query", nargs="?", default="")
    search_p.add_argument("--limit", type=int, default=10)

    get_p = subs.add_parser("get", help="CLI get by id or sku")
    get_p.add_argument("--id", default="")
    get_p.add_argument("--sku", default="")


def _cli_handler(args: argparse.Namespace) -> int:
    cmd = getattr(args, "catalog_command", None)
    if cmd == "init":
        path = store.init_catalog(getattr(args, "vertical", "autos"))
        print(f"lead-catalog: initialized {path} vertical={getattr(args, 'vertical', 'autos')}")
        return 0
    if cmd == "export-rag":
        path = export_rag(ingest=bool(getattr(args, "ingest", False)))
        print(f"lead-catalog: wrote {path}")
        return 0
    if cmd == "seed":
        n = seed_vertical(args.name, replace=bool(getattr(args, "replace", False)))
        print(f"lead-catalog: seeded {n} items ({args.name})")
        return 0
    if cmd == "search":
        print(
            _handle_catalog_search(
                {"query": getattr(args, "query", "") or "", "limit": getattr(args, "limit", 10)}
            )
        )
        return 0
    if cmd == "get":
        print(
            _handle_catalog_get(
                {"id": getattr(args, "id", "") or "", "sku": getattr(args, "sku", "") or ""}
            )
        )
        return 0
    print("Usage: hermes lead-catalog <init|export-rag|seed|search|get>")
    return 1
