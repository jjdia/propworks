import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { sendNotificationEmail, buildBroadcastEmail } from '../lib/emailNotify';
import { supabase } from '../lib/supabase';

type Target = 'all_tenants' | 'property' | 'selected_tenants';

export function Broadcasts() {
  const navigate = useNavigate();
  const ownerId = useAppStore((s) => s.ownerId) ?? '';
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);
  const tenants = useLiveQuery(() => db.tenants.filter((t) => !t.deleted_at).sortBy('full_name'), []);
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at && l.status === 'active').toArray(), []);
  const rentalUnits = useLiveQuery(() => db.rental_units.toArray(), []);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<Target>('all_tenants');
  const [propertyId, setPropertyId] = useState('');
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function tenantsForProperty(propId: string) {
    const unitIds = new Set(rentalUnits?.filter((u) => u.property_id === propId).map((u) => u.id) ?? []);
    const tenantIds = new Set(leases?.filter((l) => unitIds.has(l.rental_unit_id)).map((l) => l.tenant_id) ?? []);
    return tenants?.filter((t) => tenantIds.has(t.id)) ?? [];
  }

  function recipientTenants() {
    if (target === 'all_tenants') return tenants ?? [];
    if (target === 'property') return propertyId ? tenantsForProperty(propertyId) : [];
    return (tenants ?? []).filter((t) => selectedTenantIds.includes(t.id));
  }

  function toggleTenant(id: string) {
    setSelectedTenantIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim() || !supabase) return;
    const recipients = recipientTenants().filter((t) => t.email);
    if (recipients.length === 0) {
      setError('No recipients with an email on file for this target.');
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);

    const { data: broadcast, error: insertErr } = await supabase.from('broadcasts').insert({
      owner_id: ownerId, subject: subject.trim(), body: body.trim(), target,
      property_id: target === 'property' ? propertyId : null,
    }).select().single();

    if (insertErr || !broadcast) {
      setError(insertErr?.message ?? 'Failed to create broadcast record.');
      setSending(false);
      return;
    }

    let sent = 0, skipped = 0;
    for (const tenant of recipients) {
      try {
        await sendNotificationEmail({
          to: tenant.email!,
          content: buildBroadcastEmail(tenant.full_name, subject.trim(), body.trim()),
          kind: 'broadcast', ownerId, tenantId: tenant.id, relatedId: broadcast.id,
        });
        await supabase.from('broadcast_recipients').insert({ broadcast_id: broadcast.id, tenant_id: tenant.id, email_status: 'sent' });
        sent++;
      } catch {
        await supabase.from('broadcast_recipients').insert({ broadcast_id: broadcast.id, tenant_id: tenant.id, email_status: 'failed' });
        skipped++;
      }
    }
    setResult({ sent, skipped });
    setSending(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Announcements</h1>
      <p className="text-xs text-slate-500">Send a message to your tenants — e.g. pest control scheduling, building notices.</p>

      <Field label="Subject"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Pest control — Tuesday 10/14" /></Field>
      <Field label="Message"><textarea className={inputCls} rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>

      <Field label="Send to">
        <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value as Target)}>
          <option value="all_tenants">All tenants</option>
          <option value="property">One property</option>
          <option value="selected_tenants">Selected tenants</option>
        </select>
      </Field>

      {target === 'property' && (
        <Field label="Property">
          <select className={inputCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Select a property…</option>
            {properties?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}

      {target === 'selected_tenants' && (
        <div>
          <span className="text-slate-400 text-xs">Tenants</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {tenants?.map((t) => (
              <button
                key={t.id} type="button" onClick={() => toggleTenant(t.id)}
                className={`text-xs rounded-full px-3 py-1 ${selectedTenantIds.includes(t.id) ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'}`}
              >
                {t.full_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500">{recipientTenants().length} recipient{recipientTenants().length === 1 ? '' : 's'} ({recipientTenants().filter((t) => t.email).length} with an email on file)</p>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      {result && <p className="text-xs text-emerald-400">Sent to {result.sent}, failed for {result.skipped}.</p>}

      <div className="flex gap-2">
        <button
          onClick={() => navigate('/more')}
          disabled={sending}
          className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 py-2 text-sm font-medium"
        >
          {result ? 'Done' : 'Cancel'}
        </button>
        <button
          onClick={handleSend}
          disabled={sending || !subject.trim() || !body.trim()}
          className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
        >
          {sending ? 'Sending…' : 'Send announcement'}
        </button>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
