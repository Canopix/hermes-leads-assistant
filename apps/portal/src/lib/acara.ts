/**
 * ACARA vehicle catalog — local JSON first, live API as redundancy.
 *
 * Sync: `python3 apps/portal/scripts/sync-acara.py`
 * Data: `apps/portal/data/acara/autos.json`
 */

import fs from "fs";
import path from "path";

const ACARA_BASE = "https://api.acara.org.ar/api/v1";
export const ACARA_VEHICLE_TYPE_AUTOS = "1";

export interface AcaraNamed {
  id: number;
  name: string;
}

export interface AcaraModel extends AcaraNamed {
  versions: AcaraNamed[];
}

export interface AcaraBrand extends AcaraNamed {
  models: AcaraModel[];
}

export interface AcaraCatalog {
  source: string;
  vehicle_type: string;
  synced_at?: string;
  partial?: boolean;
  counts?: { brands: number; models: number; versions: number };
  brands: AcaraBrand[];
}

type CacheEntry<T> = { at: number; data: T };

const TTL_MS = 12 * 60 * 60 * 1000;
let catalogMem: CacheEntry<AcaraCatalog> | null = null;
const liveModelsCache = new Map<number, CacheEntry<AcaraNamed[]>>();
const liveVersionsCache = new Map<string, CacheEntry<AcaraNamed[]>>();

const KEEP_UPPER = new Set([
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
]);

function titleCaseBrand(name: string): string {
  const trimmed = name.trim();
  const upper = trimmed.toUpperCase();
  if (KEEP_UPPER.has(upper) || KEEP_UPPER.has(trimmed)) {
    return upper === "B Y D" || upper === "BYD" ? "BYD" : upper;
  }
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((w) =>
      w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
}

function dedupeByName(items: AcaraNamed[]): AcaraNamed[] {
  const seen = new Map<string, AcaraNamed>();
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, { id: item.id, name: item.name.trim() });
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es")
  );
}

function localJsonPath(): string {
  // apps/portal/data/acara/autos.json — Next server cwd is usually apps/portal
  const candidates = [
    path.join(process.cwd(), "data", "acara", "autos.json"),
    path.join(process.cwd(), "apps", "portal", "data", "acara", "autos.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

export function loadLocalCatalog(): AcaraCatalog | null {
  try {
    const p = localJsonPath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as AcaraCatalog;
    if (!raw?.brands?.length) return null;
    return raw;
  } catch {
    return null;
  }
}

export function getCatalog(): AcaraCatalog | null {
  const now = Date.now();
  if (catalogMem && now - catalogMem.at < TTL_MS) return catalogMem.data;
  const local = loadLocalCatalog();
  if (local) {
    catalogMem = { at: now, data: local };
    return local;
  }
  return null;
}

export function getLocalBrands(): AcaraNamed[] {
  const cat = getCatalog();
  if (!cat) return [];
  return cat.brands.map((b) => ({ id: b.id, name: b.name }));
}

export function getLocalModels(brandId: number): AcaraModel[] {
  const cat = getCatalog();
  if (!cat) return [];
  const brand = cat.brands.find((b) => b.id === brandId);
  return brand?.models || [];
}

export function getLocalVersions(
  brandId: number,
  modelId: number
): AcaraNamed[] {
  const models = getLocalModels(brandId);
  const model = models.find((m) => m.id === modelId);
  return model?.versions || [];
}

export function findBrandIdByName(name: string): number | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const hit = getLocalBrands().find((b) => b.name.toLowerCase() === key);
  return hit ? hit.id : null;
}

export function findModelIdByName(
  brandId: number,
  name: string
): number | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const hit = getLocalModels(brandId).find(
    (m) => m.name.toLowerCase() === key
  );
  return hit ? hit.id : null;
}

async function acaraGet<T>(
  apiPath: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`${ACARA_BASE}${apiPath}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "LeadAI-Assistant/1.0 (catalog marca/modelo)",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ACARA HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Brands: local JSON first, live ACARA fallback. */
export async function fetchAcaraBrands(): Promise<{
  brands: AcaraNamed[];
  source: "local" | "acara";
  synced_at?: string;
}> {
  const local = getLocalBrands();
  if (local.length > 0) {
    return {
      brands: local,
      source: "local",
      synced_at: getCatalog()?.synced_at,
    };
  }
  const raw = await acaraGet<{ data: AcaraNamed[] }>("/prices/brand-list", {
    vehiculeType: ACARA_VEHICLE_TYPE_AUTOS,
  });
  const brands = dedupeByName(
    (raw.data || []).map((b) => ({
      id: b.id,
      name: titleCaseBrand(b.name),
    }))
  );
  return { brands, source: "acara" };
}

/** Models for a brand: local first, live fallback. */
export async function fetchAcaraModels(brandId: number): Promise<{
  models: AcaraNamed[];
  source: "local" | "acara";
}> {
  if (!Number.isFinite(brandId) || brandId <= 0) {
    return { models: [], source: "local" };
  }
  const local = getLocalModels(brandId);
  if (local.length > 0) {
    return {
      models: local.map((m) => ({ id: m.id, name: m.name })),
      source: "local",
    };
  }

  const now = Date.now();
  const cached = liveModelsCache.get(brandId);
  if (cached && now - cached.at < TTL_MS) {
    return { models: cached.data, source: "acara" };
  }
  const raw = await acaraGet<{ data: AcaraNamed[] }>("/prices/model-list", {
    vehiculeType: ACARA_VEHICLE_TYPE_AUTOS,
    vehiculeBrandId: String(brandId),
  });
  const models = dedupeByName(raw.data || []);
  liveModelsCache.set(brandId, { at: now, data: models });
  return { models, source: "acara" };
}

/** Versions for brand+model: local first, live fallback. */
export async function fetchAcaraVersions(
  brandId: number,
  modelId: number
): Promise<{ versions: AcaraNamed[]; source: "local" | "acara" }> {
  if (
    !Number.isFinite(brandId) ||
    brandId <= 0 ||
    !Number.isFinite(modelId) ||
    modelId <= 0
  ) {
    return { versions: [], source: "local" };
  }
  const local = getLocalVersions(brandId, modelId);
  if (local.length > 0) {
    return { versions: local, source: "local" };
  }

  const cacheKey = `${brandId}:${modelId}`;
  const now = Date.now();
  const cached = liveVersionsCache.get(cacheKey);
  if (cached && now - cached.at < TTL_MS) {
    return { versions: cached.data, source: "acara" };
  }
  const raw = await acaraGet<{ data: AcaraNamed[] }>("/prices/version-list", {
    vehiculeType: ACARA_VEHICLE_TYPE_AUTOS,
    vehiculeBrandId: String(brandId),
    vehiculeModelId: String(modelId),
  });
  const versions = dedupeByName(raw.data || []);
  liveVersionsCache.set(cacheKey, { at: now, data: versions });
  return { versions, source: "acara" };
}
