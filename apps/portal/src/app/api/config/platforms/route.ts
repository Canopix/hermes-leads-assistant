import { NextRequest, NextResponse } from "next/server";
import { getConfigYaml, updateConfigYaml } from "@/lib/config-service";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { platformsConfigSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  const yaml = getConfigYaml(ctx.tenant.slug);
  if (!yaml) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const platforms: Record<string, Record<string, unknown>> = {};

  const tgMatch = yaml.match(/telegram:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
  if (tgMatch) {
    const tokenMatch = tgMatch[1].match(/bot_token:\s*['"]?([^'"\n]+)['"]?/);
    const webhookMatch = tgMatch[1].match(/webhook_url:\s*['"]?([^'"\n]+)['"]?/);
    const enabledMatch = tgMatch[1].match(/enabled:\s*(true|false)/);
    platforms.telegram = {
      enabled: enabledMatch ? enabledMatch[1] === "true" : false,
      bot_token: tokenMatch ? tokenMatch[1] : "",
      webhook_url: webhookMatch ? webhookMatch[1] : "",
    };
  } else {
    platforms.telegram = { enabled: false, bot_token: "", webhook_url: "" };
  }

  const kapsoMatch = yaml.match(/kapso:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
  if (kapsoMatch) {
    const keyMatch = kapsoMatch[1].match(/api_key:\s*['"]?([^'"\n]+)['"]?/);
    const enabledMatch = kapsoMatch[1].match(/enabled:\s*(true|false)/);
    platforms.kapso = {
      enabled: enabledMatch ? enabledMatch[1] === "true" : false,
      api_key: keyMatch ? keyMatch[1] : "",
    };
  } else {
    platforms.kapso = { enabled: false, api_key: "" };
  }

  return NextResponse.json(platforms);
}

export async function PUT(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  const raw = await request.json().catch(() => null);
  const parsed = platformsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "body inválido" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const yaml = getConfigYaml(ctx.tenant.slug);
  if (!yaml) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let newYaml = yaml;
  const changed: string[] = [];

  if (body.telegram) {
    const tg = body.telegram;
    if (tg.enabled !== undefined && newYaml.match(/telegram:\s*\n\s*enabled:\s*/)) {
      newYaml = newYaml.replace(
        /(telegram:\s*\n\s*enabled:\s*)(true|false)/,
        `$1${tg.enabled}`
      );
      changed.push("telegram.enabled");
    }
    if (tg.bot_token !== undefined && newYaml.match(/bot_token:/)) {
      newYaml = newYaml.replace(
        /(bot_token:\s*)['"]?[^'"\n]+['"]?/,
        `$1'${tg.bot_token}'`
      );
      changed.push("telegram.bot_token");
    }
  }
  if (body.kapso) {
    const k = body.kapso;
    if (k.enabled !== undefined && newYaml.match(/kapso:\s*\n\s*enabled:\s*/)) {
      newYaml = newYaml.replace(
        /(kapso:\s*\n\s*enabled:\s*)(true|false)/,
        `$1${k.enabled}`
      );
      changed.push("kapso.enabled");
    }
  }

  const ok = updateConfigYaml(ctx.tenant.slug, newYaml);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
  if (changed.length > 0) {
    await audit("config.platforms.update", "config.yaml", { fields: changed });
  }
  return NextResponse.json({ ok: true });
}
