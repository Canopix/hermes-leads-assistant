import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-test-"));

vi.mock("@/lib/profiles", () => ({
  getProfilesDir: () => tmpRoot,
}));

vi.mock("@/lib/config-service", () => ({
  reindexRag: () => ({ ok: true, output: "mocked ingest" }),
}));

import {
  createCatalogItem,
  deleteCatalogItem,
  exportCatalogRag,
  initCatalog,
  listCatalogItems,
  updateCatalogItem,
} from "@/lib/catalog-service";

describe("catalog-service", () => {
  const slug = "demo";

  beforeEach(() => {
    const dir = path.join(tmpRoot, `${slug}-leads`);
    fs.mkdirSync(path.join(dir, "knowledge"), { recursive: true });
    initCatalog(slug, "autos");
  });

  afterEach(() => {
    const dir = path.join(tmpRoot, `${slug}-leads`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates, lists, updates and exports autos items", () => {
    const item = createCatalogItem(slug, {
      title: "Toyota Corolla 2021",
      status: "available",
      price_amount: 26_800_000,
      price_kind: "fixed",
      summary: "Usado",
      description: "Único dueño",
      attrs: {
        marca: "Toyota",
        modelo: "Corolla",
        anio: 2021,
        km: 58000,
        condicion: "usado",
      },
    });
    expect(item.id).toBeTruthy();
    expect(item.attrs.marca).toBe("Toyota");

    const listed = listCatalogItems(slug, { q: "Toyota" });
    expect(listed?.total).toBe(1);
    expect(listed?.vertical).toBe("autos");

    const updated = updateCatalogItem(slug, item.id, {
      price_amount: 25_000_000,
    });
    expect(updated.price_amount).toBe(25_000_000);

    const exported = exportCatalogRag(slug);
    expect(exported).toBeTruthy();
    const md = fs.readFileSync(exported!, "utf-8");
    expect(md).toContain("Toyota Corolla 2021");
    expect(md).toContain("25");

    expect(deleteCatalogItem(slug, item.id)).toBe(true);
    expect(listCatalogItems(slug)?.total).toBe(0);
  });

  it("validates inmobiliaria attrs", () => {
    initCatalog(slug, "inmobiliaria");
    const item = createCatalogItem(slug, {
      title: "Depto Palermo",
      price_amount: 185_000,
      price_currency: "USD",
      price_kind: "fixed",
      attrs: {
        tipo: "depto",
        operacion: "venta",
        ambientes: 2,
        barrio: "Palermo",
        ciudad: "CABA",
      },
    });
    expect(item.attrs.barrio).toBe("Palermo");
  });
});
