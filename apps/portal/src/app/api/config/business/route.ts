import { NextRequest, NextResponse } from "next/server";
import { getConfigYaml, updateConfigYaml } from "@/lib/config-service";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { businessConfigSchema } from "@/lib/schemas";

interface BusinessConfig {
  client_name: string;
  business_hours: string;
  out_of_hours_message: string;
  rate_limit_message: string;
  max_messages_per_hour: number;
  max_message_length: number;
  allowed_topics: string[];
}

function parseBusinessConfig(yaml: string): BusinessConfig {
  const getField = (pattern: RegExp, fallback: string): string => {
    const m = yaml.match(pattern);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : fallback;
  };

  const topicsMatch = yaml.match(/allowed_topics:\s*\n((?:\s*-\s*.+\n?)+)/);
  const topics = topicsMatch
    ? topicsMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s*-\s*/, "").trim())
        .filter(Boolean)
    : [];

  return {
    client_name: getField(/client_name:\s*['"]?([^'"\n]+)['"]?/, ""),
    business_hours: getField(
      /business_hours:\s*['"]?([^'"\n]+)['"]?/,
      "09:00-18:00 America/Argentina/Buenos_Aires"
    ),
    out_of_hours_message: getField(/out_of_hours_message:\s*["'](.+?)["']/, ""),
    rate_limit_message: getField(/rate_limit_message:\s*["'](.+?)["']/, ""),
    max_messages_per_hour: parseInt(
      getField(/max_messages_per_hour:\s*(\d+)/, "30"),
      10
    ),
    max_message_length: parseInt(
      getField(/max_message_length:\s*(\d+)/, "4000"),
      10
    ),
    allowed_topics: topics,
  };
}

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
  return NextResponse.json(parseBusinessConfig(yaml));
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
  const parsed = businessConfigSchema.safeParse(raw);
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

  if (body.client_name !== undefined) {
    if (newYaml.match(/client_name:/)) {
      newYaml = newYaml.replace(
        /(client_name:\s*)['"]?[^'"\n]+['"]?/,
        `$1'${body.client_name}'`
      );
      changed.push("client_name");
    }
  }
  if (body.business_hours !== undefined && newYaml.match(/business_hours:/)) {
    newYaml = newYaml.replace(
      /(business_hours:\s*)['"]?[^'"\n]+['"]?/,
      `$1'${body.business_hours}'`
    );
    changed.push("business_hours");
  }
  if (
    body.out_of_hours_message !== undefined &&
    newYaml.match(/out_of_hours_message:/)
  ) {
    newYaml = newYaml.replace(
      /(out_of_hours_message:\s*)["'](.+?)["']/,
      `$1"${body.out_of_hours_message.replace(/"/g, '\\"')}"`
    );
    changed.push("out_of_hours_message");
  }
  if (
    body.rate_limit_message !== undefined &&
    newYaml.match(/rate_limit_message:/)
  ) {
    newYaml = newYaml.replace(
      /(rate_limit_message:\s*)["'](.+?)["']/,
      `$1"${body.rate_limit_message.replace(/"/g, '\\"')}"`
    );
    changed.push("rate_limit_message");
  }
  if (
    body.max_messages_per_hour !== undefined &&
    newYaml.match(/max_messages_per_hour:/)
  ) {
    newYaml = newYaml.replace(
      /(max_messages_per_hour:\s*)\d+/,
      `$1${body.max_messages_per_hour}`
    );
    changed.push("max_messages_per_hour");
  }
  if (
    body.max_message_length !== undefined &&
    newYaml.match(/max_message_length:/)
  ) {
    newYaml = newYaml.replace(
      /(max_message_length:\s*)\d+/,
      `$1${body.max_message_length}`
    );
    changed.push("max_message_length");
  }
  if (body.allowed_topics !== undefined && newYaml.match(/allowed_topics:/)) {
    const topicsYaml = body.allowed_topics.map((t) => `  - ${t}`).join("\n");
    newYaml = newYaml.replace(
      /(allowed_topics:\s*\n)(?:\s*-\s*.+\n?)+/,
      `$1${topicsYaml}\n`
    );
    changed.push("allowed_topics");
  }

  const ok = updateConfigYaml(ctx.tenant.slug, newYaml);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
  if (changed.length > 0) {
    await audit("config.business.update", "config.yaml", { fields: changed });
  }
  return NextResponse.json({ ok: true });
}
