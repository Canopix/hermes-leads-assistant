import { z } from "zod";

/**
 * Reusable zod schemas for portal API request bodies. Bounded lengths
 * prevent accidental DB bloat and abuse via large PATCH bodies.
 */

export const leadColumnSchema = z.object({
  column: z.enum(["frio", "tibio", "caliente", "descartado"]),
});

export const soulSchema = z.object({
  content: z.string().min(1).max(64 * 1024),
});

export const knowledgeFileSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9_\-]+\.md$/i, "filename must match /^[a-z0-9_-]+\\.md$/i"),
  content: z.string().min(0).max(2 * 1024 * 1024),
});

export const knowledgeContentSchema = z.object({
  content: z.string().min(0).max(2 * 1024 * 1024),
});

export const settingsYamlSchema = z.object({
  content: z.string().min(1).max(256 * 1024),
});

export const extractionHintsSchema = z.object({
  content: z.string().min(0).max(64 * 1024),
});

export const businessConfigSchema = z
  .object({
    client_name: z.string().min(1).max(200).optional(),
    business_hours: z.string().max(200).optional(),
    out_of_hours_message: z.string().max(2000).optional(),
    rate_limit_message: z.string().max(2000).optional(),
    max_messages_per_hour: z.number().int().min(1).max(10000).optional(),
    max_message_length: z.number().int().min(100).max(50000).optional(),
    allowed_topics: z.array(z.string().max(100)).max(50).optional(),
  })
  .strict();

export const platformsConfigSchema = z
  .object({
    telegram: z
      .object({
        enabled: z.boolean().optional(),
        bot_token: z.string().min(1).max(200).optional(),
        webhook_url: z.string().url().max(500).optional().or(z.literal("")).optional(),
      })
      .strict()
      .optional(),
    kapso: z
      .object({
        enabled: z.boolean().optional(),
        api_key: z.string().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const adminCreateTenantSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(64),
  name: z.string().min(1).max(200),
  channels: z.array(z.string().max(40)).max(10).optional(),
});

export const adminPatchTenantSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(64),
  status: z.enum(["active", "suspended", "inactive"]),
});

export const adminPatchUserSchema = z.object({
  user_id: z.string().min(1).max(200),
  role: z.enum(["viewer", "admin", "owner", "super_admin"]),
});

export const adminAddMemberSchema = z.object({
  user_id: z.string().min(1).max(200),
  role: z.enum(["owner", "admin", "viewer"]),
});

export const opsSchema = z.object({
  op: z.enum(["restart", "reindex"]),
});

export const playgroundChatSchema = z.object({
  tenant_slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(64),
  message: z.string().min(1).max(8000),
  session_id: z.string().regex(/^[A-Za-z0-9_\-]+$/).max(200).nullable().optional(),
});
