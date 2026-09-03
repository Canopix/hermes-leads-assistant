import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { playgroundChatSchema } from "@/lib/schemas";
import { getTenantBySlug } from "@/lib/tenants";
import { upsertPlaygroundSession, titleFromMessage } from "@/lib/playground";
import { runAgentMessage } from "@/lib/config-service";
import { logger } from "@/lib/logger";

/**
 * Send a single message to a tenant's bot from the super admin playground.
 *
 * Body: `{ tenant_slug, message, session_id? }`.
 *   - If `session_id` is null/absent, Hermes starts a new conversation and
 *     returns a fresh session id, which we persist in `playground_sessions`.
 *   - If present, we pass it to `hermes chat -r <id>` so the agent resumes
 *     that conversation.
 *
 * Returns: `{ reply, session_id, session_portal_id }`.
 *
 * Rate-limited to 20 req/min because each call blocks an LLM turn.
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = playgroundChatSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "body inválido" },
      { status: 400 }
    );
  }
  const { tenant_slug, message, session_id } = parsed.data;

  // Validate the tenant exists and is accessible.
  const tenant = await getTenantBySlug(tenant_slug);
  if (!tenant) {
    return NextResponse.json(
      { error: `tenant '${tenant_slug}' no encontrado` },
      { status: 404 }
    );
  }
  if (tenant.status === "suspended") {
    return NextResponse.json(
      { error: "tenant suspendido — reactivá el tenant primero" },
      { status: 409 }
    );
  }

  const result = runAgentMessage(tenant_slug, message, {
    resumeSessionId: session_id ?? undefined,
    // Generous timeout for first-time model loading / RAG retrieval.
    timeoutMs: 120_000,
  });

  if (!result.ok || !result.sessionId) {
    logger.error(
      {
        tenant: tenant_slug,
        session_id,
        err: result.error,
        route: "POST /api/admin/playground/chat",
      },
      "playground_message_failed"
    );
    return NextResponse.json(
      { error: result.error || "el agente no devolvió una respuesta válida" },
      { status: 502 }
    );
  }

  // Persist the session pointer so the UI can list/resume it later.
  // Only set the title when it's a brand new session (session_id was null);
  // otherwise keep the original title.
  const session = await upsertPlaygroundSession({
    tenant_slug,
    hermes_session_id: result.sessionId,
    title: session_id ? undefined : titleFromMessage(message),
    created_by_user_id: guard.userId,
    created_by_email: guard.userEmail,
  });

  return NextResponse.json({
    reply: result.reply,
    session_id: result.sessionId,
    session_portal_id: session.id,
    tenant_slug,
  });
}
