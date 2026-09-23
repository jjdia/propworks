// Shared record shape: every synced entity has these fields.
// `dirty` and `pendingDelete` are LOCAL-ONLY (never sent to Supabase) — they
// drive the outbox sync engine. `deleted_at` IS sent to Supabase (soft delete).
export interface SyncMeta {
  id: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty?: boolean;        // has local changes not yet pushed
}

export interface Property extends SyncMeta {
  name: string;
  address_line?: string;
  city?: string;
  state?: string;
  zip?: string;
  property_type?: string;
  entity_name?: string;
  has_mortgage?: boolean;
  notes?: string;
}

export type UnitKind = 'apartment' | 'garage' | 'parking' | 'storage' | 'other';
export type UnitStatus = 'vacant' | 'occupied' | 'available' | 'advertising';

export interface RentalUnit extends SyncMeta {
  property_id: string;
  name: string;
  unit_kind: UnitKind;
  status: UnitStatus;
  notes?: string;
}

export interface Tenant extends SyncMeta {
  full_name: string;
  phone?: string;
  email?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  other_occupants?: string;
  pets?: string;
  notes?: string;
}

export type LeaseStatus = 'active' | 'ended' | 'draft';
export type SubsidyProgram = 'none' | 'section8' | 'cityfheps' | 'hra';
export type PaymentFrequency = 'monthly' | 'twice_monthly';
export type TenantPaymentMethod = 'direct' | 'hra';

export interface Lease extends SyncMeta {
  rental_unit_id: string;
  tenant_id: string;
  lease_start?: string;
  lease_end?: string;
  total_monthly_rent: number;
  subsidy_program?: SubsidyProgram;
  government_portion?: number;
  // How the government/subsidy portion gets paid in. HRA is always
  // twice-monthly (15th + 30th) in practice; CityFHEPS varies case by case;
  // Section 8 is typically monthly. Editable regardless, since Jeff said
  // CityFHEPS specifically varies per tenant.
  government_payment_frequency?: PaymentFrequency;
  tenant_portion?: number;
  // Some tenants pay their portion directly; some have it paid on their
  // behalf through HRA (which also runs on the 15th/30th schedule).
  tenant_payment_method?: TenantPaymentMethod;
  rent_due_day?: number;
  security_deposit?: number;
  status: LeaseStatus;
  notes?: string;
}

export type ChargeStatus = 'unknown' | 'due' | 'paid' | 'late' | 'partial';

export interface RentCharge extends SyncMeta {
  lease_id: string;
  charge_month: string; // YYYY-MM-01
  total_rent: number;
  government_portion?: number;
  tenant_portion?: number;
  due_date?: string;
  status: ChargeStatus;
  notes?: string;
}

export type PaymentSource = 'tenant' | 'section8' | 'cityfheps' | 'hra' | 'other_agency';

export interface RentPayment extends SyncMeta {
  rent_charge_id: string;
  paid_date: string;
  amount: number;
  source: PaymentSource;
  notes?: string;
}

// One row per actual due sub-payment within a month's rent_charge — the
// piece that makes twice-monthly HRA/CityFHEPS schedules trackable. A
// single rent_charge can spawn 1-4 of these: up to 2 for the government
// portion (monthly vs. 15th+30th) and up to 2 for the tenant portion
// (direct-pay monthly, or HRA-paid 15th+30th).
export type InstallmentPortion = 'government' | 'tenant';
export type InstallmentStatus = 'unknown' | 'due' | 'paid' | 'late' | 'partial';

export interface RentInstallment extends SyncMeta {
  rent_charge_id: string;
  portion: InstallmentPortion;
  payer: SubsidyProgram | 'tenant'; // who actually pays this specific installment
  amount: number;
  due_date: string;
  status: InstallmentStatus;
  paid_date?: string;
  paid_amount?: number;
  notes?: string;
}

export type PaidBy = 'landlord' | 'tenant' | 'split_reimbursed';
export type Frequency = 'one_time' | 'monthly' | 'quarterly' | 'seasonal' | 'annual';

export interface Expense extends SyncMeta {
  property_id: string;
  expense_date: string;
  category: string;
  paid_by: PaidBy;
  frequency: Frequency;
  vendor?: string;
  amount: number;
  billing_period?: string;
  description?: string;
}

export const EXPENSE_CATEGORIES = [
  'Water / Sewer', 'Electric', 'Gas / Heating Fuel', 'Internet / Smart Devices',
  'HVAC / AC Maintenance', 'Furnace / Boiler / Heating Maintenance', 'Pest Control',
  'Landscaping / Grounds', 'Snow Removal', 'Repairs & Maintenance', 'Insurance',
  'Property Taxes', 'Mortgage Payment', 'Mortgage Interest',
  'Municipal Fines / Tickets / Building Violations', 'Legal / Professional',
  'Management Fees', 'Supplies', 'Capital Improvement', 'Miscellaneous',
] as const;

// ---------------------------------------------------------------------------
// Maintenance / contractor marketplace types. These are NOT synced through
// Dexie/outbox — they're shared, multi-party, live state (tenant, owner, and
// contractor all looking at the same rows from different accounts), so the
// UI reads/writes them straight from Supabase. See src/lib/maintenance.ts.
// ---------------------------------------------------------------------------

export type UserRole = 'owner' | 'tenant' | 'contractor';
export type ContractorStatus = 'pending' | 'approved' | 'rejected';

export interface Profile {
  id: string;
  owner_id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  tenant_id: string | null;
  contractor_status: ContractorStatus | null;
  trade: string | null;
}

export type RequestUrgency = 'normal' | 'important' | 'urgent' | 'emergency';
export type RequestStatus = 'submitted' | 'approved_for_bidding' | 'awarded' | 'completed' | 'closed' | 'rejected';

export interface MaintenanceRequest {
  id: string;
  owner_id: string;
  property_id: string;
  rental_unit_id: string | null;
  tenant_id: string | null;
  submitted_by: string;
  title: string;
  description: string | null;
  urgency: RequestUrgency;
  permission_to_enter: boolean;
  photos: string[];
  status: RequestStatus;
  awarded_bid_id: string | null;
  created_at: string;
  updated_at: string;
}

export type BidStatus = 'pending' | 'awarded' | 'rejected';

export interface JobBid {
  id: string;
  owner_id: string;
  maintenance_request_id: string;
  contractor_id: string;
  amount: number;
  message: string | null;
  status: BidStatus;
  created_at: string;
}

export interface JobCompletion {
  id: string;
  owner_id: string;
  maintenance_request_id: string;
  contractor_id: string;
  notes: string | null;
  photos: string[];
  payment_status: 'pending' | 'paid';
  submitted_at: string;
}

// Outbox: one row per local mutation waiting to be pushed to Supabase.
export interface OutboxItem {
  id: string;              // uuid, own identity
  table: string;
  recordId: string;
  op: 'upsert' | 'delete';
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

// --------------------------------------------------------------- documents
export type DocumentType = 'lease' | 'contract' | 'notice' | 'receipt' | 'insurance' | 'tax' | 'other';

export interface PropertyDocument extends SyncMeta {
  property_id: string;
  tenant_id?: string;
  lease_id?: string;
  doc_type: DocumentType;
  title: string;
  content: string; // plain text of the generated/stored document
}

// ------------------------------------------------------------- contractors
// The owner's own private roster/rolodex — distinct from the `Profile`
// portal-login concept (a contractor who's signed up and been approved to
// see jobs). A roster entry can exist with no portal account at all.
export interface Contractor extends SyncMeta {
  full_name: string;
  trade?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

// ------------------------------------------------------ scheduled maintenance
export type MaintenanceFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
export type ScheduleStatus = 'active' | 'paused';

export interface MaintenanceSchedule extends SyncMeta {
  property_id: string;
  title: string;
  description?: string;
  frequency: MaintenanceFrequency;
  next_due_date: string;
  last_completed_date?: string;
  assigned_contractor_id?: string;
  status: ScheduleStatus;
  notes?: string;
}
