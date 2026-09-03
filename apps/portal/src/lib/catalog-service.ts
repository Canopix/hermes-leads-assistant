/**
 * Structured catalog (autos / inmobiliaria) — SQLite catalog.db per profile.
 * Mirrors packages/hermes-dist/plugins/lead-catalog/store.py
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { getProfilesDir } from "./profiles";
import { reindexRag, type OpResult } from "./config-service";

const SAFE_SLUG_RE = /^[a-z0-9\-]+$/;
const EXPORT_FILENAME = "catalog-generated.md";
const SCHEMA_VERSION = 1;

export const VERTICALS = ["autos", "inmobiliaria"] as const;
export type Vertical = (typeof VERTICALS)[number];

export const STATUS_VALUES = ["available", "reserved", "sold", "draft"] as const;
export type ItemStatus = (typeof STATUS_VALUES)[number];

export const PRICE_KINDS = ["fixed", "from", "on_request"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export interface CatalogItem {
  id: string;
  sku: string | null;
  title: string;
  status: ItemStatus;
  price_amount: number | null;
  price_currency: string;
  price_kind: PriceKind;
  summary: string;
  description: string;
  attrs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type CatalogSort =
  | "updated_at"
  | "title"
  | "price_amount"
  | "status";

export interface CatalogListOpts {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
  price_min?: number;
  price_max?: number;
  /** Attr equality filters (marca, condicion, barrio, tipo, operacion, …) */
  attrs?: Record<string, string | number>;
  sort?: CatalogSort;
  order?: "asc" | "desc";
}

export interface CatalogListResult {
  vertical: Vertical;
  items: CatalogItem[];
  total: number;
  status_counts: Record<string, number>;
  filter_options: {
    marcas: string[];
    barrios: string[];
  };
}

function profileDir(slug: string): string | null {
  if (!SAFE_SLUG_RE.test(slug)) return null;
  const dir = path.join(getProfilesDir(), `${slug}-leads`);
  return fs.existsSync(dir) ? dir : null;
}

function catalogDbPath(slug: string): string | null {
  const dir = profileDir(slug);
  if (!dir) return null;
  return path.join(dir, "catalog.db");
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function openDb(slug: string): Database.Database | null {
  const dbPath = catalogDbPath(slug);
  if (!dbPath) return null;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) return null;
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  ensureSchema(db);
  return db;
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((r) => r.version)
  );

  if (!applied.has(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        sku TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        price_amount INTEGER,
        price_currency TEXT NOT NULL DEFAULT 'ARS',
        price_kind TEXT NOT NULL DEFAULT 'fixed',
        summary TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        attrs_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_items_status_price ON items(status, price_amount);
      CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
      CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);
    `);
    const hasVertical = db
      .prepare("SELECT value FROM meta WHERE key = 'vertical'")
      .get() as { value: string } | undefined;
    if (!hasVertical) {
      db.prepare("INSERT INTO meta (key, value) VALUES ('vertical', 'autos')").run();
    }
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)"
    ).run(String(SCHEMA_VERSION));
    db.prepare(
      "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)"
    ).run(1, "init catalog meta + items", nowIso());
  }
}

function getMeta(db: Database.Database, key: string, fallback = ""): string {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function parseAttrs(raw: string): Record<string, unknown> {
  try {
    const data = JSON.parse(raw || "{}");
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapRow(row: Record<string, unknown>): CatalogItem {
  return {
    id: String(row.id),
    sku:
      row.sku !== null && row.sku !== undefined && row.sku !== ""
        ? String(row.sku)
        : null,
    title: String(row.title || ""),
    status: String(row.status || "available") as ItemStatus,
    price_amount:
      row.price_amount === null || row.price_amount === undefined
        ? null
        : Number(row.price_amount),
    price_currency: String(row.price_currency || "ARS"),
    price_kind: String(row.price_kind || "fixed") as PriceKind,
    summary: String(row.summary || ""),
    description: String(row.description || ""),
    attrs: parseAttrs(String(row.attrs_json || "{}")),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

function requireStr(attrs: Record<string, unknown>, key: string): string {
  const v = attrs[key];
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new CatalogError(`attrs.${key} es obligatorio`);
  }
  return String(v).trim();
}

function optionalStr(
  attrs: Record<string, unknown>,
  key: string
): string | undefined {
  const v = attrs[key];
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  return String(v).trim();
}

function requireInt(
  attrs: Record<string, unknown>,
  key: string,
  min?: number
): number {
  if (attrs[key] === undefined || attrs[key] === null || attrs[key] === "") {
    throw new CatalogError(`attrs.${key} es obligatorio`);
  }
  const n = Number(attrs[key]);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new CatalogError(`attrs.${key} debe ser entero`);
  }
  if (min !== undefined && n < min) {
    throw new CatalogError(`attrs.${key} debe ser >= ${min}`);
  }
  return n;
}

function optionalInt(
  attrs: Record<string, unknown>,
  key: string,
  min?: number
): number | undefined {
  if (attrs[key] === undefined || attrs[key] === null || attrs[key] === "") {
    return undefined;
  }
  const n = Number(attrs[key]);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new CatalogError(`attrs.${key} debe ser entero`);
  }
  if (min !== undefined && n < min) {
    throw new CatalogError(`attrs.${key} debe ser >= ${min}`);
  }
  return n;
}

export function normalizeAttrs(
  vertical: Vertical,
  attrs: Record<string, unknown>
): Record<string, unknown> {
  if (vertical === "autos") {
    const out: Record<string, unknown> = {
      marca: requireStr(attrs, "marca"),
      modelo: requireStr(attrs, "modelo"),
      anio: requireInt(attrs, "anio", 1900),
      km: requireInt(attrs, "km", 0),
      condicion: requireStr(attrs, "condicion").toLowerCase(),
    };
    if (out.condicion !== "0km" && out.condicion !== "usado") {
      throw new CatalogError(`attrs.condicion inválido: ${out.condicion}`);
    }
    for (const key of [
      "version",
      "combustible",
      "transmision",
      "equipamiento",
      "ideal_para",
    ]) {
      const v = optionalStr(attrs, key);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  const out: Record<string, unknown> = {
    tipo: requireStr(attrs, "tipo").toLowerCase(),
    operacion: requireStr(attrs, "operacion").toLowerCase(),
    ambientes: requireInt(attrs, "ambientes", 0),
    barrio: requireStr(attrs, "barrio"),
    ciudad: requireStr(attrs, "ciudad"),
  };
  const tipos = new Set(["depto", "casa", "ph", "local", "terreno"]);
  const ops = new Set(["venta", "alquiler"]);
  if (!tipos.has(String(out.tipo))) {
    throw new CatalogError(`attrs.tipo inválido: ${out.tipo}`);
  }
  if (!ops.has(String(out.operacion))) {
    throw new CatalogError(`attrs.operacion inválido: ${out.operacion}`);
  }
  const m2 = optionalInt(attrs, "m2", 0);
  if (m2 !== undefined) out.m2 = m2;
  const amenities = optionalStr(attrs, "amenities");
  if (amenities !== undefined) out.amenities = amenities;
  return out;
}

export function getCatalogVertical(slug: string): Vertical | null {
  const db = openDb(slug);
  if (!db) return null;
  try {
    const v = getMeta(db, "vertical", "autos");
    return VERTICALS.includes(v as Vertical) ? (v as Vertical) : "autos";
  } finally {
    db.close();
  }
}

export function setCatalogVertical(slug: string, vertical: Vertical): boolean {
  if (!VERTICALS.includes(vertical)) return false;
  const db = openDb(slug);
  if (!db) return false;
  try {
    setMeta(db, "vertical", vertical);
    return true;
  } finally {
    db.close();
  }
}

export function initCatalog(slug: string, vertical: Vertical = "autos"): boolean {
  const dir = profileDir(slug);
  if (!dir) return false;
  const db = openDb(slug);
  if (!db) return false;
  try {
    setMeta(db, "vertical", vertical);
    return true;
  } finally {
    db.close();
  }
}

const SORT_COLUMNS: Record<CatalogSort, string> = {
  updated_at: "updated_at",
  title: "title COLLATE NOCASE",
  price_amount: "price_amount",
  status: "status",
};

function safeAttrKey(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(key);
}

export function listCatalogItems(
  slug: string,
  opts: CatalogListOpts = {}
): CatalogListResult | null {
  const db = openDb(slug);
  if (!db) return null;
  try {
    const verticalRaw = (getMeta(db, "vertical", "autos") || "autos") as Vertical;
    const vertical = VERTICALS.includes(verticalRaw) ? verticalRaw : "autos";
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (opts.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts.q?.trim()) {
      clauses.push(
        "(title LIKE ? OR summary LIKE ? OR IFNULL(sku, '') LIKE ? OR attrs_json LIKE ?)"
      );
      const like = `%${opts.q.trim()}%`;
      params.push(like, like, like, like);
    }
    if (opts.price_min !== undefined && Number.isFinite(opts.price_min)) {
      clauses.push("price_amount IS NOT NULL AND price_amount >= ?");
      params.push(Math.trunc(opts.price_min));
    }
    if (opts.price_max !== undefined && Number.isFinite(opts.price_max)) {
      clauses.push("price_amount IS NOT NULL AND price_amount <= ?");
      params.push(Math.trunc(opts.price_max));
    }
    for (const [key, value] of Object.entries(opts.attrs || {})) {
      if (value === undefined || value === null || value === "") continue;
      if (!safeAttrKey(key)) continue;
      clauses.push("json_extract(attrs_json, ?) = ?");
      params.push(`$.${key}`, value);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM items ${where}`).get(...params) as {
        n: number;
      }
    ).n;

    const sortKey: CatalogSort =
      opts.sort && SORT_COLUMNS[opts.sort] ? opts.sort : "updated_at";
    const order = opts.order === "asc" ? "ASC" : "DESC";
    // NULLs last for price when sorting by price
    const orderSql =
      sortKey === "price_amount"
        ? `price_amount IS NULL, price_amount ${order}`
        : `${SORT_COLUMNS[sortKey]} ${order}`;

    const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const rows = db
      .prepare(
        `SELECT * FROM items ${where} ORDER BY ${orderSql} LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    const statusRows = db
      .prepare(`SELECT status, COUNT(*) AS n FROM items GROUP BY status`)
      .all() as { status: string; n: number }[];
    const status_counts: Record<string, number> = {};
    for (const row of statusRows) {
      status_counts[row.status] = row.n;
    }

    const marcas = (
      db
        .prepare(
          `SELECT DISTINCT json_extract(attrs_json, '$.marca') AS v
           FROM items
           WHERE json_extract(attrs_json, '$.marca') IS NOT NULL
           ORDER BY v COLLATE NOCASE`
        )
        .all() as { v: string }[]
    )
      .map((r) => r.v)
      .filter(Boolean);

    const barrios = (
      db
        .prepare(
          `SELECT DISTINCT json_extract(attrs_json, '$.barrio') AS v
           FROM items
           WHERE json_extract(attrs_json, '$.barrio') IS NOT NULL
           ORDER BY v COLLATE NOCASE`
        )
        .all() as { v: string }[]
    )
      .map((r) => r.v)
      .filter(Boolean);

    return {
      vertical,
      items: rows.map(mapRow),
      total,
      status_counts,
      filter_options: { marcas, barrios },
    };
  } finally {
    db.close();
  }
}

export function getCatalogItem(slug: string, id: string): CatalogItem | null {
  const db = openDb(slug);
  if (!db) return null;
  try {
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRow(row) : null;
  } finally {
    db.close();
  }
}

function validateItemPayload(
  vertical: Vertical,
  payload: Record<string, unknown>
): {
  title: string;
  status: ItemStatus;
  price_amount: number | null;
  price_currency: string;
  price_kind: PriceKind;
  summary: string;
  description: string;
  sku: string | null;
  attrs: Record<string, unknown>;
} {
  const title = String(payload.title || "").trim();
  if (!title) throw new CatalogError("title es obligatorio");

  const status = String(payload.status || "available") as ItemStatus;
  if (!STATUS_VALUES.includes(status)) {
    throw new CatalogError(`status inválido: ${status}`);
  }

  const price_kind = String(payload.price_kind || "fixed") as PriceKind;
  if (!PRICE_KINDS.includes(price_kind)) {
    throw new CatalogError(`price_kind inválido: ${price_kind}`);
  }

  const price_currency =
    String(payload.price_currency || "ARS").trim().toUpperCase() || "ARS";

  let price_amount: number | null;
  if (price_kind === "on_request") {
    price_amount = null;
  } else if (
    payload.price_amount === undefined ||
    payload.price_amount === null ||
    payload.price_amount === ""
  ) {
    throw new CatalogError(
      "price_amount es obligatorio salvo price_kind=on_request"
    );
  } else {
    price_amount = Number(payload.price_amount);
    if (!Number.isFinite(price_amount) || !Number.isInteger(price_amount)) {
      throw new CatalogError("price_amount debe ser entero");
    }
    if (price_amount < 0) throw new CatalogError("price_amount debe ser >= 0");
  }

  const attrs = normalizeAttrs(
    vertical,
    (payload.attrs as Record<string, unknown>) || {}
  );
  const skuRaw = payload.sku;
  const sku =
    skuRaw === undefined || skuRaw === null || String(skuRaw).trim() === ""
      ? null
      : String(skuRaw).trim();

  return {
    title,
    status,
    price_amount,
    price_currency,
    price_kind,
    summary: String(payload.summary || "").trim(),
    description: String(payload.description || "").trim(),
    sku,
    attrs,
  };
}

export function createCatalogItem(
  slug: string,
  payload: Record<string, unknown>
): CatalogItem {
  const db = openDb(slug);
  if (!db) throw new CatalogError("perfil no encontrado");
  try {
    const vertical = (getMeta(db, "vertical", "autos") || "autos") as Vertical;
    const v = VERTICALS.includes(vertical) ? vertical : "autos";
    const data = validateItemPayload(v, payload);
    const id = String(payload.id || randomUUID());
    const now = nowIso();
    db.prepare(
      `INSERT INTO items (
        id, sku, title, status, price_amount, price_currency, price_kind,
        summary, description, attrs_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.sku,
      data.title,
      data.status,
      data.price_amount,
      data.price_currency,
      data.price_kind,
      data.summary,
      data.description,
      JSON.stringify(data.attrs),
      now,
      now
    );
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new CatalogError("falló al crear ítem");
    return mapRow(row);
  } finally {
    db.close();
  }
}

export function updateCatalogItem(
  slug: string,
  id: string,
  payload: Record<string, unknown>
): CatalogItem {
  const existing = getCatalogItem(slug, id);
  if (!existing) throw new CatalogError("ítem no encontrado");

  const db = openDb(slug);
  if (!db) throw new CatalogError("perfil no encontrado");
  try {
    const vertical = (getMeta(db, "vertical", "autos") || "autos") as Vertical;
    const v = VERTICALS.includes(vertical) ? vertical : "autos";
    const merged = {
      ...existing,
      ...payload,
      attrs: payload.attrs ?? existing.attrs,
    };
    const data = validateItemPayload(v, merged);
    const now = nowIso();
    db.prepare(
      `UPDATE items SET
        sku = ?, title = ?, status = ?, price_amount = ?, price_currency = ?,
        price_kind = ?, summary = ?, description = ?, attrs_json = ?, updated_at = ?
      WHERE id = ?`
    ).run(
      data.sku,
      data.title,
      data.status,
      data.price_amount,
      data.price_currency,
      data.price_kind,
      data.summary,
      data.description,
      JSON.stringify(data.attrs),
      now,
      id
    );
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new CatalogError("falló al actualizar ítem");
    return mapRow(row);
  } finally {
    db.close();
  }
}

export function deleteCatalogItem(slug: string, id: string): boolean {
  const db = openDb(slug);
  if (!db) return false;
  try {
    const info = db.prepare("DELETE FROM items WHERE id = ?").run(id);
    return info.changes > 0;
  } finally {
    db.close();
  }
}

function formatPrice(item: CatalogItem): string {
  if (item.price_kind === "on_request" || item.price_amount === null) {
    return "A consultar";
  }
  const formatted = `$${item.price_amount.toLocaleString("es-AR")}`;
  if (item.price_kind === "from") {
    return `Desde ${formatted} ${item.price_currency}`;
  }
  return `${formatted} ${item.price_currency}`;
}

const AUTOS_LABELS: Record<string, string> = {
  marca: "Marca",
  modelo: "Modelo",
  version: "Versión",
  anio: "Año",
  km: "Kilómetros",
  condicion: "Condición",
  combustible: "Combustible",
  transmision: "Transmisión",
  equipamiento: "Equipamiento",
  ideal_para: "Ideal para",
};

const INMO_LABELS: Record<string, string> = {
  tipo: "Tipo",
  operacion: "Operación",
  ambientes: "Ambientes",
  m2: "m²",
  barrio: "Barrio",
  ciudad: "Ciudad",
  amenities: "Amenities",
};

function itemToMarkdown(item: CatalogItem, vertical: Vertical): string {
  const labels = vertical === "autos" ? AUTOS_LABELS : INMO_LABELS;
  const lines = [
    `### ${item.title}`,
    `- **Precio:** ${formatPrice(item)}`,
  ];
  if (item.sku) lines.push(`- **SKU:** ${item.sku}`);
  lines.push(`- **Estado:** ${item.status}`);
  if (item.summary) lines.push(`- **Resumen:** ${item.summary}`);
  for (const [key, label] of Object.entries(labels)) {
    const val = item.attrs[key];
    if (val !== undefined && val !== null && val !== "") {
      lines.push(`- **${label}:** ${val}`);
    }
  }
  if (item.description) {
    lines.push("");
    lines.push(item.description.trim());
  }
  return lines.join("\n");
}

export function exportCatalogRag(slug: string): string | null {
  const dir = profileDir(slug);
  if (!dir) return null;
  const list = listCatalogItems(slug, { limit: 10_000, offset: 0 });
  if (!list) return null;

  const published = list.items.filter((i) =>
    ["available", "reserved"].includes(i.status)
  );
  const header =
    `# Catálogo (${list.vertical})\n\n` +
    "Documento generado automáticamente desde el catálogo estructurado.\n" +
    "Para precios y disponibilidad exactos el bot debe usar las tools " +
    "`catalog_search` / `catalog_get`.\n\n";
  const body =
    published.length === 0
      ? "_No hay ítems publicados en el catálogo._\n"
      : published.map((i) => itemToMarkdown(i, list.vertical)).join("\n\n") +
        "\n";

  const kb = path.join(dir, "knowledge");
  fs.mkdirSync(kb, { recursive: true });
  const out = path.join(kb, EXPORT_FILENAME);
  fs.writeFileSync(out, header + body, "utf-8");
  return out;
}

/** After catalog mutations: export markdown + reindex RAG. */
export function syncCatalogToRag(slug: string): OpResult {
  const exported = exportCatalogRag(slug);
  if (!exported) {
    return { ok: false, output: "no se pudo exportar el catálogo" };
  }
  const rag = reindexRag(slug);
  return {
    ok: rag.ok,
    output: `export ${exported}; ${rag.output}`,
  };
}
