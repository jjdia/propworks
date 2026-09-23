import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { buildLeaseDocument, LEGAL_REVIEW_NOTICE, lawfulLateFeeCap, type LeaseDocInput, type LeaseDocument, type UtilityPayer } from '../lib/leaseTemplate';
import { buildGarageDocument, GARAGE_LEGAL_REVIEW_NOTICE, type GarageDocInput, type GarageDocument } from '../lib/garageTemplate';
import { buildDocumentPdf, documentPdfFileName } from '../lib/leasePdf';
import { saveDocument, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import type { Lease } from '../lib/types';

type DocKind = 'residential' | 'garage';
type Step = 1 | 2 | 'preview';
const UTILITY_KEYS = ['Heat', 'Hot Water', 'Water', 'Gas', 'Electricity', 'Internet'] as const;

export function LeaseGenerator() {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const [docKind, setDocKind] = useState<DocKind>('residential');
  const [step, setStep] = useState<Step>(1);
  const [doc, setDoc] = useState<LeaseDocument | GarageDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at).toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);
  const units = useLiveQuery(() => db.rental_units.toArray(), []);

  const [propertyId, setPropertyId] = useState('');
  const [entityName, setEntityName] = useState('');
  const [landlordName, setLandlordName] = useState('');
  const selectedProperty = properties?.find((p) => p.id === propertyId);
  const reviewNotice = docKind === 'residential' ? LEGAL_REVIEW_NOTICE : GARAGE_LEGAL_REVIEW_NOTICE;

  function selectProperty(id: string) {
    setPropertyId(id);
    const p = properties?.find((pp) => pp.id === id);
    setEntityName(p?.entity_name ?? '');
  }

  // ---------- Residential lease state ----------
  const [builtBefore1978, setBuiltBefore1978] = useState(false);
  const [rentStabilized, setRentStabilized] = useState(false);
  const [rentStabilizedRiderRequired, setRentStabilizedRiderRequired] = useState(true);
  const [goodCauseApplies, setGoodCauseApplies] = useState(false);
  const [goodCauseSmallLandlordExempt, setGoodCauseSmallLandlordExempt] = useState(true);
  const [windowGuardsRequired, setWindowGuardsRequired] = useState(false);
  const [bedBugHistory, setBedBugHistory] = useState(false);
  const [bedBugDetails, setBedBugDetails] = useState('');
  const [sprinklerSystemPresent, setSprinklerSystemPresent] = useState(false);
  const [stoveKnobCoversRequired, setStoveKnobCoversRequired] = useState(false);
  const [floodRisk, setFloodRisk] = useState(false);
  const [floodRiskDetails, setFloodRiskDetails] = useState('');

  const [leaseId, setLeaseId] = useState('');
  const [isRenewal, setIsRenewal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('ACH transfer, check, or money order');
  const [dishonoredPaymentFee, setDishonoredPaymentFee] = useState('');
  const [utilityAssignment, setUtilityAssignment] = useState<Partial<Record<string, UtilityPayer>>>({});
  const [petsAllowed, setPetsAllowed] = useState(false);
  const [petsPolicy, setPetsPolicy] = useState('');
  const [smokingAllowed, setSmokingAllowed] = useState(false);
  const [parkingIncluded, setParkingIncluded] = useState(false);
  const [parkingDetails, setParkingDetails] = useState('');
  const [backyardAccess, setBackyardAccess] = useState(false);
  const [garageOrBasementAccess, setGarageOrBasementAccess] = useState(false);
  const [commonAreaLimitations, setCommonAreaLimitations] = useState('');
  const [insuranceRequired, setInsuranceRequired] = useState(true);
  const [section8OrCityfhepsAddendumRequired, setSection8OrCityfhepsAddendumRequired] = useState(true);
  const [specialClauses, setSpecialClauses] = useState('');

  const propertyLeases = leases?.filter((l) => units?.find((u) => u.id === l.rental_unit_id)?.property_id === propertyId) ?? [];
  const selectedLease: Lease | undefined = leases?.find((l) => l.id === leaseId);
  const selectedTenant = selectedLease ? tenants?.find((t) => t.id === selectedLease.tenant_id) : undefined;
  const selectedUnit = selectedLease ? units?.find((u) => u.id === selectedLease.rental_unit_id) : undefined;

  function cycleUtility(key: string) {
    setUtilityAssignment((prev) => {
      const current = prev[key];
      const next = current === undefined ? 'landlord' : current === 'landlord' ? 'tenant' : undefined;
      const copy = { ...prev };
      if (next === undefined) delete copy[key]; else copy[key] = next;
      return copy;
    });
  }

  function handleGenerateResidential() {
    if (!selectedLease || !selectedTenant || !selectedUnit || !selectedProperty) return;
    const input: LeaseDocInput = {
      landlordName: landlordName || 'Landlord',
      entityName: entityName || selectedProperty.entity_name,
      propertyAddress: [selectedProperty.address_line, selectedProperty.city, selectedProperty.state].filter(Boolean).join(', ') || selectedProperty.name,
      unitName: selectedUnit.name,
      tenantNames: selectedTenant.full_name,
      otherOccupants: selectedTenant.other_occupants,
      leaseStart: selectedLease.lease_start ?? '',
      leaseEnd: selectedLease.lease_end ?? '',
      isRenewal,
      monthlyRent: Number(selectedLease.total_monthly_rent),
      dueDay: selectedLease.rent_due_day ?? 1,
      paymentMethod: paymentMethod || undefined,
      dishonoredPaymentFee: dishonoredPaymentFee ? Number(dishonoredPaymentFee) : undefined,
      securityDeposit: selectedLease.security_deposit ? Number(selectedLease.security_deposit) : undefined,
      subsidyProgram: selectedLease.subsidy_program,
      governmentPortion: selectedLease.government_portion ? Number(selectedLease.government_portion) : undefined,
      tenantPortion: selectedLease.tenant_portion ? Number(selectedLease.tenant_portion) : undefined,
      utilityAssignment: utilityAssignment as LeaseDocInput['utilityAssignment'],
      petsAllowed, petsPolicy: petsPolicy || undefined,
      smokingAllowed,
      parkingIncluded, parkingDetails: parkingDetails || undefined,
      backyardAccess, garageOrBasementAccess, commonAreaLimitations: commonAreaLimitations || undefined,
      insuranceRequired,
      builtBefore1978, rentStabilized, goodCauseApplies, goodCauseSmallLandlordExempt,
      bedBugHistory, bedBugDetails: bedBugDetails || undefined,
      windowGuardsRequired, sprinklerSystemPresent, stoveKnobCoversRequired,
      floodRisk, floodRiskDetails: floodRiskDetails || undefined,
      section8OrCityfhepsAddendumRequired, rentStabilizedRiderRequired,
      specialClauses: specialClauses || undefined,
    };
    setDoc(buildLeaseDocument(input));
    setStep('preview');
  }

  // ---------- Garage/parking state ----------
  const [garageUnitId, setGarageUnitId] = useState('');
  const [renterName, setRenterName] = useState('');
  const [garageIsMonthToMonth, setGarageIsMonthToMonth] = useState(true);
  const [garageStart, setGarageStart] = useState(new Date().toISOString().slice(0, 10));
  const [garageEnd, setGarageEnd] = useState('');
  const [garageRent, setGarageRent] = useState('');
  const [garageDueDay, setGarageDueDay] = useState('1');
  const [garageDeposit, setGarageDeposit] = useState('');
  const [permittedUse, setPermittedUse] = useState('parking one passenger vehicle');
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [accessDetails, setAccessDetails] = useState('');
  const [garageSpecialClauses, setGarageSpecialClauses] = useState('');

  const propertyUnits = units?.filter((u) => u.property_id === propertyId) ?? [];
  const selectedGarageUnit = propertyUnits.find((u) => u.id === garageUnitId);

  function handleGenerateGarage() {
    if (!selectedProperty || !selectedGarageUnit || !renterName || !garageRent) return;
    const input: GarageDocInput = {
      landlordName: landlordName || 'Landlord',
      entityName: entityName || selectedProperty.entity_name,
      propertyAddress: [selectedProperty.address_line, selectedProperty.city, selectedProperty.state].filter(Boolean).join(', ') || selectedProperty.name,
      spaceName: selectedGarageUnit.name,
      renterName,
      leaseStart: garageStart,
      leaseEnd: garageEnd,
      isMonthToMonth: garageIsMonthToMonth,
      monthlyRent: Number(garageRent),
      dueDay: Number(garageDueDay) || 1,
      securityDeposit: garageDeposit ? Number(garageDeposit) : undefined,
      permittedUse,
      vehicleInfo: vehicleInfo || undefined,
      accessDetails: accessDetails || undefined,
      specialClauses: garageSpecialClauses || undefined,
    };
    setDoc(buildGarageDocument(input));
    setStep('preview');
  }

  // ---------- Shared preview/export actions ----------
  async function handleSave() {
    if (!doc || !selectedProperty) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const content = doc.sections.map((s) => `${s.heading}\n${s.body.join('\n')}`).join('\n\n');
      await saveDocument({
        ...blankMeta(ownerId),
        property_id: selectedProperty.id,
        tenant_id: docKind === 'residential' ? selectedTenant?.id : undefined,
        lease_id: docKind === 'residential' ? selectedLease?.id : undefined,
        doc_type: 'lease',
        title: doc.title,
        content: `${content}\n\n${reviewNotice}`,
      });
      setSaveMsg('Saved to Documents.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (!doc) return;
    const blob = await buildDocumentPdf(doc, reviewNotice);
    const fileName = documentPdfFileName(
      docKind === 'residential' ? 'Lease' : 'Garage',
      selectedProperty?.name ?? 'property',
      docKind === 'residential' ? (selectedUnit?.name ?? '') : (selectedGarageUnit?.name ?? ''),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleShare() {
    if (!doc) return;
    const blob = await buildDocumentPdf(doc, reviewNotice);
    const fileName = documentPdfFileName(
      docKind === 'residential' ? 'Lease' : 'Garage',
      selectedProperty?.name ?? 'property',
      docKind === 'residential' ? (selectedUnit?.name ?? '') : (selectedGarageUnit?.name ?? ''),
    );
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: fileName }); }
      catch (err) { if (!(err instanceof DOMException && err.name === 'AbortError')) handleDownload(); }
    } else {
      handleDownload();
    }
  }

  if (step === 'preview' && doc) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Preview</h1>
          <button onClick={() => setStep(docKind === 'garage' ? 1 : 2)} className="text-xs text-slate-400 hover:text-slate-200">← Edit</button>
        </div>

        <div className="bg-amber-950 border border-amber-800 rounded-xl p-3 text-xs text-amber-200">{reviewNotice}</div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm">
          <span className="text-slate-400">{docKind === 'residential' ? 'Landlord' : 'Owner'} on this document: </span>
          <span className="font-medium">{doc.landlordLabel}</span>
        </div>

        <div className="bg-white text-slate-900 rounded-xl p-5 font-serif space-y-4 text-sm leading-relaxed">
          <h2 className="text-base font-bold">{doc.title}</h2>
          {doc.sections.map((s, i) => (
            <div key={i}>
              <h3 className="font-bold text-sm mb-1">{s.heading}</h3>
              {s.body.map((p, j) => <p key={j} className="mb-1">{p}</p>)}
            </div>
          ))}
        </div>

        {saveMsg && <p className="text-xs text-emerald-400">{saveMsg}</p>}

        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Save to Documents'}
          </button>
          <button onClick={handleDownload} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm font-medium">Download PDF</button>
          <button onClick={handleShare} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 py-2 text-sm font-medium">Share</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Lease Generator</h1>

      <div className="flex gap-2">
        {(['residential', 'garage'] as DocKind[]).map((k) => (
          <button
            key={k} onClick={() => { setDocKind(k); setStep(1); }}
            className={`flex-1 text-sm rounded-md py-2 font-medium ${docKind === k ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'}`}
          >
            {k === 'residential' ? 'Residential Lease' : 'Garage / Parking'}
          </button>
        ))}
      </div>

      {docKind === 'residential' && (
        <div className="flex gap-2 text-xs">
          <span className={`px-2 py-1 rounded-full ${step === 1 ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'}`}>1. Property &amp; legal</span>
          <span className={`px-2 py-1 rounded-full ${step === 2 ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'}`}>2. Tenant &amp; terms</span>
        </div>
      )}

      {!properties?.length ? (
        <p className="text-sm text-amber-300">Add a property first.</p>
      ) : docKind === 'garage' ? (
        <div className="space-y-3">
          <Field label="Property">
            <select className={inputCls} value={propertyId} onChange={(e) => { selectProperty(e.target.value); setGarageUnitId(''); }}>
              <option value="">Select a property…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Owner / signer name"><input className={inputCls} value={landlordName} onChange={(e) => setLandlordName(e.target.value)} placeholder="Your name" /></Field>
          <Field label="Entity holding title (optional)">
            <input className={inputCls} value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="e.g. an LLC or trust name" />
            {selectedProperty?.entity_name && entityName === selectedProperty.entity_name && (
              <p className="text-[11px] text-emerald-400 mt-1">Pulled from this property's records.</p>
            )}
          </Field>

          <Field label="Space">
            {propertyUnits.filter((u) => u.unit_kind !== 'apartment').length === 0 ? (
              <p className="text-xs text-amber-300">No garage/parking/storage units on this property — add one from the Properties page first.</p>
            ) : (
              <select className={inputCls} value={garageUnitId} onChange={(e) => setGarageUnitId(e.target.value)}>
                <option value="">Select a space…</option>
                {propertyUnits.filter((u) => u.unit_kind !== 'apartment').map((u) => <option key={u.id} value={u.id}>{u.name} ({u.unit_kind})</option>)}
              </select>
            )}
          </Field>
          <Field label="Renter name"><input className={inputCls} value={renterName} onChange={(e) => setRenterName(e.target.value)} /></Field>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={garageIsMonthToMonth} onChange={(e) => setGarageIsMonthToMonth(e.target.checked)} />
            Month-to-month (uncheck for a fixed term)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start date"><input type="date" className={inputCls} value={garageStart} onChange={(e) => setGarageStart(e.target.value)} /></Field>
            {!garageIsMonthToMonth && <Field label="End date"><input type="date" className={inputCls} value={garageEnd} onChange={(e) => setGarageEnd(e.target.value)} /></Field>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Monthly rent"><input type="number" step="0.01" className={inputCls} value={garageRent} onChange={(e) => setGarageRent(e.target.value)} /></Field>
            <Field label="Due day"><input type="number" min="1" max="28" className={inputCls} value={garageDueDay} onChange={(e) => setGarageDueDay(e.target.value)} /></Field>
          </div>
          <Field label="Security deposit (optional)"><input type="number" step="0.01" className={inputCls} value={garageDeposit} onChange={(e) => setGarageDeposit(e.target.value)} /></Field>
          <Field label="Permitted use"><input className={inputCls} value={permittedUse} onChange={(e) => setPermittedUse(e.target.value)} /></Field>
          <Field label="Vehicle info (optional)"><input className={inputCls} value={vehicleInfo} onChange={(e) => setVehicleInfo(e.target.value)} placeholder="Make, model, plate" /></Field>
          <Field label="Access details (optional)"><textarea className={inputCls} rows={2} value={accessDetails} onChange={(e) => setAccessDetails(e.target.value)} /></Field>
          <Field label="Additional terms (optional)"><textarea className={inputCls} rows={2} value={garageSpecialClauses} onChange={(e) => setGarageSpecialClauses(e.target.value)} /></Field>

          <button
            onClick={handleGenerateGarage}
            disabled={!garageUnitId || !renterName || !garageRent}
            className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
          >
            Generate agreement
          </button>
        </div>
      ) : step === 1 ? (
        <div className="space-y-3">
          <Field label="Property">
            <select className={inputCls} value={propertyId} onChange={(e) => { selectProperty(e.target.value); setLeaseId(''); }}>
              <option value="">Select a property…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Landlord / signer name"><input className={inputCls} value={landlordName} onChange={(e) => setLandlordName(e.target.value)} placeholder="Your name" /></Field>
          <Field label="Entity holding title (optional)">
            <input className={inputCls} value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="e.g. an LLC or trust name" />
            {selectedProperty?.entity_name && entityName === selectedProperty.entity_name && (
              <p className="text-[11px] text-emerald-400 mt-1">Pulled from this property's records — the lease will name this entity as Landlord, not your personal name.</p>
            )}
          </Field>

          <p className="text-xs text-slate-500 pt-1">Building &amp; legal disclosures</p>
          <Toggle label="Building was built before 1978 (federal lead paint disclosure)" checked={builtBefore1978} onChange={setBuiltBefore1978} />
          <Toggle label="Unit is rent-stabilized" checked={rentStabilized} onChange={setRentStabilized} />
          {rentStabilized && <Toggle label="Remind me to attach the DHCR RA-LR1 lease rider" checked={rentStabilizedRiderRequired} onChange={setRentStabilizedRiderRequired} />}
          <Toggle label="Good Cause Eviction Law applies to this tenancy" checked={goodCauseApplies} onChange={(v) => { setGoodCauseApplies(v); if (v) setGoodCauseSmallLandlordExempt(false); }} />
          {!goodCauseApplies && (
            <Toggle label="Claim the small-landlord exemption (≤10 units)" checked={goodCauseSmallLandlordExempt} onChange={setGoodCauseSmallLandlordExempt} />
          )}
          <Toggle label="Window guards required (child 10 or under, or requested)" checked={windowGuardsRequired} onChange={setWindowGuardsRequired} />
          <Toggle label="Sprinkler system present in building" checked={sprinklerSystemPresent} onChange={setSprinklerSystemPresent} />
          <Toggle label="Stove knob covers required" checked={stoveKnobCoversRequired} onChange={setStoveKnobCoversRequired} />
          <Toggle label="Bed bug history to disclose (past year)" checked={bedBugHistory} onChange={setBedBugHistory} />
          {bedBugHistory && <Field label="Bed bug history details"><textarea className={inputCls} rows={2} value={bedBugDetails} onChange={(e) => setBedBugDetails(e.target.value)} /></Field>}
          <Toggle label="Flood history or elevated flood risk to disclose" checked={floodRisk} onChange={setFloodRisk} />
          {floodRisk && <Field label="Flood risk details"><textarea className={inputCls} rows={2} value={floodRiskDetails} onChange={(e) => setFloodRiskDetails(e.target.value)} /></Field>}

          <button onClick={() => setStep(2)} disabled={!propertyId} className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
            Next: Tenant &amp; terms
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Tenant / lease">
            {propertyLeases.length === 0 ? (
              <p className="text-xs text-amber-300">No leases on this property yet — add one from the Rent tab first.</p>
            ) : (
              <select className={inputCls} value={leaseId} onChange={(e) => setLeaseId(e.target.value)}>
                <option value="">Select a lease…</option>
                {propertyLeases.map((l) => {
                  const t = tenants?.find((tt) => tt.id === l.tenant_id);
                  const u = units?.find((uu) => uu.id === l.rental_unit_id);
                  return <option key={l.id} value={l.id}>{t?.full_name ?? 'Unknown'} — {u?.name ?? ''}</option>;
                })}
              </select>
            )}
          </Field>

          {selectedLease && (
            <p className="text-[11px] text-slate-500">
              Late fee is auto-set to the lawful maximum for this rent: {fmtMoney(lawfulLateFeeCap(Number(selectedLease.total_monthly_rent)))} (lesser of $50 or 5% of rent, per RPL § 238-a).
            </p>
          )}

          <Toggle label="This is a renewal (not a new tenancy)" checked={isRenewal} onChange={setIsRenewal} />
          <Field label="Rent payment method"><input className={inputCls} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} /></Field>
          <Field label="Dishonored payment fee (optional)"><input type="number" step="0.01" className={inputCls} value={dishonoredPaymentFee} onChange={(e) => setDishonoredPaymentFee(e.target.value)} /></Field>

          <div>
            <span className="text-slate-400 text-xs">Utilities — tap to cycle: unassigned → Landlord pays → Tenant pays</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {UTILITY_KEYS.map((u) => {
                const payer = utilityAssignment[u];
                return (
                  <button
                    key={u} type="button" onClick={() => cycleUtility(u)}
                    className={`text-xs rounded-full px-3 py-1 ${payer === 'landlord' ? 'bg-emerald-700' : payer === 'tenant' ? 'bg-sky-700' : 'bg-slate-800 text-slate-400'}`}
                  >
                    {u}{payer ? ` · ${payer === 'landlord' ? 'Landlord' : 'Tenant'}` : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <Toggle label="Pets allowed" checked={petsAllowed} onChange={setPetsAllowed} />
          {petsAllowed && <Field label="Pet policy"><input className={inputCls} value={petsPolicy} onChange={(e) => setPetsPolicy(e.target.value)} placeholder="e.g. one dog under 30 lbs, $500 pet deposit" /></Field>}
          <Toggle label="Smoking allowed" checked={smokingAllowed} onChange={setSmokingAllowed} />

          <Toggle label="Parking included" checked={parkingIncluded} onChange={setParkingIncluded} />
          {parkingIncluded && <Field label="Parking details"><input className={inputCls} value={parkingDetails} onChange={(e) => setParkingDetails(e.target.value)} /></Field>}
          <Toggle label="Backyard access included" checked={backyardAccess} onChange={setBackyardAccess} />
          <Toggle label="Garage/basement access included" checked={garageOrBasementAccess} onChange={setGarageOrBasementAccess} />
          {garageOrBasementAccess && <Field label="Common-area limitations (optional)"><input className={inputCls} value={commonAreaLimitations} onChange={(e) => setCommonAreaLimitations(e.target.value)} /></Field>}

          <Toggle label="Renter's insurance required (not just encouraged)" checked={insuranceRequired} onChange={setInsuranceRequired} />
          {selectedLease?.subsidy_program && selectedLease.subsidy_program !== 'none' && (
            <Toggle label={`Remind me to attach the ${selectedLease.subsidy_program === 'section8' ? 'Section 8' : selectedLease.subsidy_program === 'cityfheps' ? 'CityFHEPS' : 'HRA'} program addendum`} checked={section8OrCityfhepsAddendumRequired} onChange={setSection8OrCityfhepsAddendumRequired} />
          )}

          <Field label="Additional / special terms (optional)"><textarea className={inputCls} rows={3} value={specialClauses} onChange={(e) => setSpecialClauses(e.target.value)} /></Field>

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">← Back</button>
            <button onClick={handleGenerateResidential} disabled={!leaseId} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
              Generate lease
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtMoney(n: number) { return `$${n.toFixed(2)}`; }

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
