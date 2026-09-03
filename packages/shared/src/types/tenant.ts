export interface Tenant {
  id: string;
  slug: string;
  name: string;
  hermes_profile: string;
  status: 'active' | 'inactive' | 'suspended';
  channels: ('telegram' | 'whatsapp')[];
  owner_telegram_id?: string;
  owner_whatsapp_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TenantConfig {
  slug: string;
  name: string;
  telegram_bot_token?: string;
  kapso_api_key?: string;
  kapso_phone_number_id?: string;
  owner_telegram_id?: string;
  owner_whatsapp_id?: string;
  openai_api_key?: string;
  mem0_api_key?: string;
}