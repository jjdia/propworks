import { supabase } from './supabase';
import type {
  Profile, MaintenanceRequest, JobBid, JobCompletion, RequestStatus, UserRole,
} from './types';

// ---------------------------------------------------------------------------
// Everything in this file talks to Supabase directly — no Dexie, no outbox.
// Reasoning: the properties/rent/expenses data in db.ts/mutations.ts is one
// owner's private data, read on one account, so "local-first + background
// sync" is the right model. Maintenance requests are the opposite: a
// tenant, the owner, and possibly several contractors all need to see a
// shared, authoritative, server-side state (who's approved, who's bid what,
// who won) — there's no meaningful "local copy" for that. RLS (see
// supabase/schema-v2-maintenance.sql) is what actually enforces the privacy
// rules; this file just calls through to it.
// ---------------------------------------------------------------------------

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured — the maintenance/contractor workflow needs cloud sync turned on.');
  return supabase;
}

// --------------------------------------------------------------- profile
export async function getMyProfile(): Promise<Profile | null> {
  const client = requireClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await client.from('profiles').select('*').eq('id', auth.user.id).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

// Called right after a brand-new signup with no invite code: makes the
// signer-upper the owner/admin of their own new network.
export async function createOwnerProfile(userId: string, fullName?: string) {
  const client = requireClient();
  const { error } = await client.from('profiles').insert({
    id: userId, owner_id: userId, role: 'owner' as UserRole, full_name: fullName ?? null,
  });
  if (error) throw error;
}

export async function redeemTenantInvite(_userId: string, code: string, fullName?: string) {
  const client = requireClient();
  // Runs as a SECURITY DEFINER function server-side (see
  // schema-v7-security-hardening.sql) — the client never reads the
  // tenant_invites table directly, so it can't enumerate other portfolios'
  // pending invite codes. _userId is unused; the function uses auth.uid()
  // itself so a forged id can't be passed in.
  const { error } = await client.rpc('redeem_tenant_invite', { p_code: code, p_full_name: fullName ?? null });
  if (error) throw new Error(error.message.includes('Invalid or already-used') ? 'That invite code is invalid or has already been used.' : error.message);
}

export async function redeemContractorInvite(_userId: string, code: string, fullName: string, trade?: string) {
  const client = requireClient();
  const { error } = await client.rpc('redeem_contractor_invite', { p_code: code, p_full_name: fullName, p_trade: trade ?? null });
  if (error) throw new Error(error.message.includes('Invalid or already-used') ? 'That invite code is invalid or has already been used.' : error.message);
}

// ------------------------------------------------------------- owner: invites
export async function createTenantInvite(ownerId: string, tenantId: string) {
  const client = requireClient();
  const code = randomCode();
  const { error } = await client.from('tenant_invites').insert({ owner_id: ownerId, tenant_id: tenantId, code });
  if (error) throw error;
  return code;
}

export async function createContractorInvite(ownerId: string) {
  const client = requireClient();
  const code = randomCode();
  const { error } = await client.from('contractor_invites').insert({ owner_id: ownerId, code });
  if (error) throw error;
  return code;
}

// ---------------------------------------------------------- co-owner invites
// Lets a second login (e.g. a spouse or business partner) share the SAME
// portfolio instead of getting their own empty one. See
// schema-v4-shared-portfolio.sql for how this is enforced at the RLS level.
export async function createOwnerInvite(ownerId: string) {
  const client = requireClient();
  const code = randomCode();
  const { error } = await client.from('owner_invites').insert({ owner_id: ownerId, code });
  if (error) throw error;
  return code;
}

export async function redeemOwnerInvite(_userId: string, code: string, fullName?: string) {
  const client = requireClient();
  const { error } = await client.rpc('redeem_owner_invite', { p_code: code.trim().toUpperCase(), p_full_name: fullName ?? null });
  if (error) throw new Error(error.message.includes('Invalid or already-used') ? 'That invite code is invalid or has already been used.' : error.message);
}

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ---------------------------------------------------------- owner: contractors
export async function listContractors(): Promise<Profile[]> {
  const client = requireClient();
  const { data, error } = await client.from('profiles').select('*').eq('role', 'contractor');
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function setContractorStatus(profileId: string, status: 'approved' | 'rejected') {
  const client = requireClient();
  const { error } = await client.from('profiles').update({ contractor_status: status }).eq('id', profileId);
  if (error) throw error;
}

// ----------------------------------------------------- maintenance requests
export async function listMaintenanceRequests(): Promise<MaintenanceRequest[]> {
  const client = requireClient();
  const { data, error } = await client.from('maintenance_requests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MaintenanceRequest[];
}

export async function createMaintenanceRequest(input: {
  owner_id: string; property_id: string; rental_unit_id?: string; tenant_id?: string;
  submitted_by: string; title: string; description?: string; urgency: string;
  permission_to_enter: boolean; status?: RequestStatus;
}) {
  const client = requireClient();
  const { data, error } = await client.from('maintenance_requests').insert(input).select().single();
  if (error) throw error;
  return data as MaintenanceRequest;
}

export async function setRequestStatus(id: string, status: RequestStatus) {
  const client = requireClient();
  const { error } = await client.from('maintenance_requests').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function attachRequestPhotos(id: string, photoPaths: string[]) {
  const client = requireClient();
  const { data: existing } = await client.from('maintenance_requests').select('photos').eq('id', id).single();
  const merged = [...(existing?.photos ?? []), ...photoPaths];
  const { error } = await client.from('maintenance_requests').update({ photos: merged }).eq('id', id);
  if (error) throw error;
}

// -------------------------------------------------------------------- bids
export async function listBidsForRequest(requestId: string): Promise<JobBid[]> {
  const client = requireClient();
  const { data, error } = await client.from('job_bids').select('*').eq('maintenance_request_id', requestId);
  if (error) throw error;
  return (data ?? []) as JobBid[];
}

export async function listMyBids(): Promise<JobBid[]> {
  const client = requireClient();
  const { data, error } = await client.from('job_bids').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as JobBid[];
}

export async function submitBid(input: { owner_id: string; maintenance_request_id: string; contractor_id: string; amount: number; message?: string }) {
  const client = requireClient();
  const { error } = await client.from('job_bids').insert(input);
  if (error) throw error;
}

// Award a bid: mark it awarded, reject the others, flip the request status.
export async function awardBid(requestId: string, bidId: string) {
  const client = requireClient();
  const { error: e1 } = await client.from('job_bids').update({ status: 'awarded' }).eq('id', bidId);
  if (e1) throw e1;
  const { error: e2 } = await client.from('job_bids')
    .update({ status: 'rejected' }).eq('maintenance_request_id', requestId).neq('id', bidId);
  if (e2) throw e2;
  const { error: e3 } = await client.from('maintenance_requests')
    .update({ status: 'awarded', awarded_bid_id: bidId }).eq('id', requestId);
  if (e3) throw e3;
}

// -------------------------------------------------------------- completions
export async function submitJobCompletion(input: {
  owner_id: string; maintenance_request_id: string; contractor_id: string; notes?: string; photos: string[];
}) {
  const client = requireClient();
  const { error: e1 } = await client.from('job_completions').insert(input);
  if (e1) throw e1;
  const { error: e2 } = await client.from('maintenance_requests')
    .update({ status: 'completed' }).eq('id', input.maintenance_request_id);
  if (e2) throw e2;
}

export async function listCompletions(): Promise<JobCompletion[]> {
  const client = requireClient();
  const { data, error } = await client.from('job_completions').select('*').order('submitted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as JobCompletion[];
}

export async function markCompletionPaid(id: string) {
  const client = requireClient();
  const { error } = await client.from('job_completions').update({ payment_status: 'paid' }).eq('id', id);
  if (error) throw error;
}

export async function closeRequest(id: string) {
  const client = requireClient();
  const { error } = await client.from('maintenance_requests').update({ status: 'closed' }).eq('id', id);
  if (error) throw error;
}

// ----------------------------------------------------------------- photos
export async function uploadPhoto(requestId: string, subpath: 'request' | 'completion', file: File) {
  const client = requireClient();
  const path = `${requestId}/${subpath}/${Date.now()}-${file.name}`;
  const { error } = await client.storage.from('maintenance-photos').upload(path, file);
  if (error) throw error;
  return path;
}

export async function getPhotoUrl(path: string) {
  const client = requireClient();
  const { data, error } = await client.storage.from('maintenance-photos').createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// --------------------------------------------------------- tenant context
// A tenant's own property/unit, read via the narrow tenant-read RLS
// policies (see schema-v2-maintenance.sql) — used to populate the "which
// property is this about" picker on the report-an-issue form instead of
// making them paste a UUID.
export interface TenantContext {
  propertyId: string;
  propertyName: string;
  unitName: string;
}

export async function getMyTenantContext(): Promise<TenantContext[]> {
  const client = requireClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await client
    .from('leases')
    .select('rental_unit_id, status, rental_units(id, name, property_id, properties(id, name))')
    .eq('status', 'active');
  if (error) throw error;
  type Row = { rental_units: { id: string; name: string; property_id: string; properties: { id: string; name: string } | null } | null };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.rental_units?.properties)
    .map((r) => ({
      propertyId: r.rental_units!.properties!.id,
      propertyName: r.rental_units!.properties!.name,
      unitName: r.rental_units!.name,
    }));
}
