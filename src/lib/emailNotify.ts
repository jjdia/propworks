import { supabase } from './supabase';
import type { EmailContent } from './emailTemplates';
export * from './emailTemplates';

// ------------------------------------------------------------------- sender
export async function sendNotificationEmail(params: {
  to: string; content: EmailContent; kind: 'onboarding' | 'rent_reminder' | 'maintenance_update' | 'broadcast';
  ownerId: string; tenantId?: string; relatedId?: string;
}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      to: params.to, subject: params.content.subject, html: params.content.html,
      kind: params.kind, owner_id: params.ownerId, tenant_id: params.tenantId, related_id: params.relatedId,
    },
  });
  if (error) throw error;
  return data;
}
