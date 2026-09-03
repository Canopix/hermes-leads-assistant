/**
 * Lead types — derived from the SQLite schema in
 * `packages/hermes-dist/plugins/lead-capture/db.py` (the source of truth).
 *
 * Drift between this file and the Python schema is caught by
 * `apps/portal/tests/contract/lead-schema.test.ts`, which fails CI if a
 * column exists in SQLite but not here (or vice versa).
 *
 * The JSON Schema artifact at `packages/shared/schemas/lead.json` is
 * regenerated from `schema.py` and read by the contract test.
 */

export const KANBAN_COLUMNS = ['frio', 'tibio', 'caliente'] as const;
export const VALID_KANBAN_COLUMNS = ['frio', 'tibio', 'caliente', 'descartado'] as const;
export const VALID_TEMPERATURES = ['frio', 'tibio', 'caliente'] as const;
export const VALID_URGENCIES = ['low', 'medium', 'high'] as const;
export const VALID_PLATFORMS = ['telegram', 'kapso', 'web'] as const;
export const VALID_COLUMN_SOURCES = ['llm', 'manual'] as const;

export type KanbanColumn = (typeof KANBAN_COLUMNS)[number];
export type ValidKanbanColumn = (typeof VALID_KANBAN_COLUMNS)[number];
export type Temperature = (typeof VALID_TEMPERATURES)[number];
export type Urgency = (typeof VALID_URGENCIES)[number];
export type Platform = (typeof VALID_PLATFORMS)[number];
export type ColumnSource = (typeof VALID_COLUMN_SOURCES)[number];

/**
 * A lead as stored in `leads.db`. Every field maps 1:1 to a SQLite column
 * in `packages/hermes-dist/plugins/lead-capture/db.py`.
 *
 * `tenant_id` is implicit (one DB per tenant) and not stored in the row.
 */
export interface Lead {
  id: string;
  user_id: string;
  session_id: string | null;
  platform: Platform | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  interest: string | null;
  urgency: Urgency;
  temperature: Temperature;
  kanban_column: ValidKanbanColumn;
  position: number;
  summary: string | null;
  notes: string | null;
  last_user_message: string | null;
  last_assistant_message: string | null;
  raw_extraction: string | null;
  last_extracted_at: string | null;
  column_source: ColumnSource;
  column_locked_at: string | null;
  manual_override: number; // 0 | 1 (SQLite stores it as INTEGER)
  created_at: string;
  updated_at: string;
}

/**
 * Convenience view of a Lead for UI consumers. Synthesized by the portal's
 * `mapRow` helper from the raw Lead. Not a separate DB row.
 */
export interface LeadView {
  id: string;
  name: string;
  email: string;
  phone: string;
  interest: string;
  temperature: Temperature;
  column: ValidKanbanColumn;
  platform: string;
  urgency: Urgency;
  summary: string;
  last_message: string;
  session_id?: string;
  created_at: string;
  updated_at: string;
  raw_fields?: Record<string, string>;
  manual_override?: boolean;
}

export interface LeadEvent {
  id: number;
  lead_id: string;
  event_type: string;
  payload: string | null;
  created_at: string;
}

/**
 * Aggregate stats returned by `/api/stats` and `/api/dashboard`. The shape
 * matches `get_stats()` in `db.py` and `getLeadStats()` in the portal's
 * `db.ts`. Do not change unilaterally — both sides assert this in the
 * contract test.
 */
export interface LeadStats {
  total: number;
  today: number;
  by_column: {
    frio: number;
    tibio: number;
    caliente: number;
    descartado: number;
  };
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_name?: string;
  timestamp: number;
}

export interface LeadWithConversation extends LeadView {
  conversation: ConversationMessage[];
}
