#!/usr/bin/env python3
"""Download ACARA autos catalog (marca → modelo → versión) to a local JSON file.

Usage:
  python3 apps/portal/scripts/sync-acara.py
  python3 apps/portal/scripts/sync-acara.py --resume

Writes apps/portal/data/acara/autos.json (~few MB). Portal reads this first;
live ACARA API is only a fallback.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://api.acara.org.ar/api/v1"
VEHICLE_TYPE = "1"  # autos
# ACARA rate-limits aggressively (~429). Keep this conservative.
SLEEP = 1.2
SLEEP_BETWEEN_BRANDS = 3.0
SLEEP_429_BASE = 30.0
RETRIES = 12
KEEP_UPPER = {
    "BMW",
    "BYD",
    "B Y D",
    "MG",
    "GAC",
    "DFSK",
    "JMC",
    "JAC",
    "KIA",
    "DS",
    "RAM",
    "SWM",
    "FAW",
    "BAIC",
}


def title_case_brand(name: str) -> str:
    trimmed = name.strip()
    upper = trimmed.upper()
    if upper in KEEP_UPPER or trimmed in KEEP_UPPER:
        return "BYD" if upper in {"B Y D", "BYD"} else upper
    parts = []
    for w in trimmed.lower().split():
        if len(w) <= 2:
            parts.append(w.upper())
        else:
            parts.append(w[0].upper() + w[1:])
    return " ".join(parts)


def http_get(path: str, params: dict[str, str], retries: int = RETRIES) -> dict:
    qs = urllib.parse.urlencode(params)
    url = f"{BASE}{path}?{qs}"
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    "User-Agent": "LeadAI-Assistant/1.0 (acara sync)",
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            last_err = exc
            wait = 2.0 * (attempt + 1)
            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                if retry_after and str(retry_after).isdigit():
                    wait = max(float(retry_after), SLEEP_429_BASE)
                else:
                    wait = SLEEP_429_BASE * (attempt + 1)
            print(f"  retry {attempt + 1}/{retries} after {wait:.0f}s ({exc})", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError) as exc:
            last_err = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"ACARA GET failed {path}: {last_err}")


def dedupe_named(items: list[dict]) -> list[dict]:
    seen: OrderedDict[str, dict] = OrderedDict()
    for item in items:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen[key] = {"id": int(item["id"]), "name": name}
    return list(seen.values())


def load_partial(path: Path) -> dict[int, dict]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    out: dict[int, dict] = {}
    for b in data.get("brands") or []:
        out[int(b["id"])] = b
    return out


def save_payload(out_path: Path, brands_out: list[dict], partial: bool = False) -> None:
    total_models = sum(len(b.get("models") or []) for b in brands_out)
    total_versions = sum(
        len(m.get("versions") or [])
        for b in brands_out
        for m in (b.get("models") or [])
    )
    payload = {
        "source": "acara",
        "vehicle_type": "autos",
        "vehicle_type_id": VEHICLE_TYPE,
        "synced_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "partial": partial,
        "counts": {
            "brands": len(brands_out),
            "models": total_models,
            "versions": total_versions,
        },
        "brands": brands_out,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(out_path)


def sync(out_path: Path, resume: bool) -> None:
    done = load_partial(out_path) if resume else {}
    brands_raw = http_get("/prices/brand-list", {"vehiculeType": VEHICLE_TYPE}).get(
        "data"
    ) or []
    brands_out: list[dict] = []

    for i, brand in enumerate(brands_raw, 1):
        bid = int(brand["id"])
        bname = title_case_brand(str(brand["name"]))
        if bid in done and done[bid].get("models") is not None:
            print(f"[{i}/{len(brands_raw)}] {bname} (cached)", flush=True)
            brands_out.append(done[bid])
            continue

        print(f"[{i}/{len(brands_raw)}] {bname}…", flush=True)
        if i > 1:
            time.sleep(SLEEP_BETWEEN_BRANDS)
        time.sleep(SLEEP)
        models_raw = http_get(
            "/prices/model-list",
            {"vehiculeType": VEHICLE_TYPE, "vehiculeBrandId": str(bid)},
        ).get("data") or []
        models = dedupe_named(models_raw)
        models_out: list[dict] = []
        for model in models:
            time.sleep(SLEEP)
            versions_raw = http_get(
                "/prices/version-list",
                {
                    "vehiculeType": VEHICLE_TYPE,
                    "vehiculeBrandId": str(bid),
                    "vehiculeModelId": str(model["id"]),
                },
            ).get("data") or []
            versions = dedupe_named(versions_raw)
            models_out.append(
                {
                    "id": model["id"],
                    "name": model["name"],
                    "versions": versions,
                }
            )
        entry = {"id": bid, "name": bname, "models": models_out}
        brands_out.append(entry)
        done[bid] = entry
        # checkpoint after each brand
        save_payload(out_path, list(done.values()), partial=True)

    # order by original brand list
    ordered = []
    for brand in brands_raw:
        bid = int(brand["id"])
        ordered.append(done[bid])
    save_payload(out_path, ordered, partial=False)
    size_kb = out_path.stat().st_size / 1024
    print(f"Wrote {out_path} ({size_kb:.1f} KB)", flush=True)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=root / "data" / "acara" / "autos.json",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from existing out file (skip completed brands)",
    )
    args = parser.parse_args()
    try:
        sync(args.out, resume=args.resume)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
