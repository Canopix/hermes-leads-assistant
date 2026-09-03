/**
 * Optional Sentry integration. Activates only if `SENTRY_DSN` is set in the
 * environment. The import is dynamic so the SDK isn't pulled into the bundle
 * when Sentry is not in use (keeps dev & test lightweight).
 *
 * Wire `captureException` from any route handler's catch block:
 *
 *   try { ... } catch (e) {
 *     logger.error({ err: e }, "thing_failed");
 *     await captureException(e);
 *     return NextResponse.json({ error: "..." }, { status: 500 });
 *   }
 */

/**
 * Minimal shape of what beforeSend receives. Keeping this local avoids
 * pulling in `@sentry/types` (which isn't always resolvable through the
 * `@sentry/nextjs` re-export tree) and keeps the SDK fully optional.
 */

let initialized = false;
let sentryModule: typeof import("@sentry/nextjs") | null = null;
let initAttempted = false;

async function ensureInit() {
  if (initAttempted) return;
  initAttempted = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // Not configured — no-op.

  try {
    sentryModule = await import("@sentry/nextjs");
    sentryModule.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      // Strip cookies/auth headers before send.
      // @ts-expect-error — Sentry event type is intentionally loose here.
      beforeSend(event: Record<string, unknown>) {
        const headers = (event?.request as { headers?: Record<string, unknown> } | undefined)?.headers;
        if (headers) {
          delete headers.cookie;
          delete headers.authorization;
        }
        return event;
      },
    });
    initialized = true;
  } catch (e) {
    // Sentry is optional; don't crash if the SDK isn't installed.
    // eslint-disable-next-line no-console
    console.warn("[sentry] failed to initialize (is @sentry/nextjs installed?):", e);
  }
}

/**
 * Capture an exception. No-op if Sentry is not configured.
 */
export async function captureException(e: unknown): Promise<void> {
  await ensureInit();
  if (initialized && sentryModule) {
    sentryModule.captureException(e);
  }
}

/**
 * Whether Sentry is currently active. Useful for the /admin/health page to
 * surface "is error tracking wired up?".
 */
export function isSentryActive(): boolean {
  return initialized;
}
