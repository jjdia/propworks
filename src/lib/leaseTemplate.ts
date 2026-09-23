// ---------------------------------------------------------------------------
// Builds a New York residential lease as structured sections (heading +
// body paragraphs), driven entirely by the inputs below. This is Claude's
// OWN standards-based TEMPLATE — it does not reproduce REBNY's proprietary
// lease form or any other copyrighted third-party document — covering
// commonly-required NY landlord-tenant provisions and disclosures. It is
// NOT legal advice and does not guarantee enforceability. The generated
// document always ends with a review notice saying so; that notice is not
// optional and every caller must render it.
//
// Kept as a pure function (input in, structured sections out) so the
// content logic can be unit-tested without touching PDF rendering, React,
// or the database.
// ---------------------------------------------------------------------------

export type UtilityPayer = 'landlord' | 'tenant';

export interface LeaseDocInput {
  landlordName: string;
  entityName?: string; // e.g. an LLC or trust holding title, if different from landlordName
  propertyAddress: string;
  unitName: string;
  tenantNames: string; // comma-separated if more than one — drives joint-and-several clause
  otherOccupants?: string;
  leaseStart: string; // YYYY-MM-DD
  leaseEnd: string;
  isRenewal: boolean;
  monthlyRent: number;
  dueDay: number;
  paymentMethod?: string; // e.g. "ACH transfer, check, or money order"
  dishonoredPaymentFee?: number; // NSF/bounced-payment charge
  securityDeposit?: number;
  subsidyProgram?: 'section8' | 'cityfheps' | 'hra' | 'none';
  governmentPortion?: number;
  tenantPortion?: number;
  // Itemized utility assignment — who pays for what, rather than a single
  // "included in rent" list. Omit a key to leave it unaddressed.
  utilityAssignment: Partial<Record<'Water' | 'Gas' | 'Electricity' | 'Internet' | 'Heat' | 'Hot Water', UtilityPayer>>;
  petsAllowed: boolean;
  petsPolicy?: string;
  smokingAllowed: boolean;
  parkingIncluded: boolean;
  parkingDetails?: string;
  backyardAccess: boolean;
  garageOrBasementAccess: boolean;
  commonAreaLimitations?: string;
  insuranceRequired: boolean;
  builtBefore1978: boolean;
  rentStabilized: boolean;
  goodCauseApplies: boolean;
  goodCauseSmallLandlordExempt: boolean; // ≤10 units — common exemption for small owners
  bedBugHistory: boolean;
  bedBugDetails?: string;
  windowGuardsRequired: boolean;
  sprinklerSystemPresent: boolean;
  stoveKnobCoversRequired: boolean;
  floodRisk: boolean;
  floodRiskDetails?: string;
  section8OrCityfhepsAddendumRequired: boolean; // reminder + override notice, not the actual gov't form
  rentStabilizedRiderRequired: boolean; // reminder to attach DHCR RA-LR1, not the actual form
  specialClauses?: string;
}

export interface LeaseSection {
  heading: string;
  body: string[]; // one entry per paragraph
}

export interface LeaseDocument {
  title: string;
  landlordLabel: string; // the exact "Landlord" name this lease uses — entity if set, else the individual
  sections: LeaseSection[];
}

function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`;
}
function fmtDate(d: string) {
  if (!d) return '____________';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function ordinalSuffix(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'st';
  if (n % 10 === 2 && n % 100 !== 12) return 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return 'rd';
  return 'th';
}
// NY RPL § 238-a caps a late fee at the LESSER of $50 or 5% of monthly rent.
export function lawfulLateFeeCap(monthlyRent: number): number {
  return Math.min(50, monthlyRent * 0.05);
}
function hasMultipleTenants(tenantNames: string): boolean {
  return tenantNames.split(',').map((s) => s.trim()).filter(Boolean).length > 1;
}

export function buildLeaseDocument(input: LeaseDocInput): LeaseDocument {
  const sections: LeaseSection[] = [];
  const landlordLabel = input.entityName ? `${input.entityName} (the "Landlord")` : `${input.landlordName} (the "Landlord")`;

  sections.push({
    heading: '1. Parties and Premises',
    body: [
      `This Residential Lease Agreement ("Lease") is entered into between ${landlordLabel} and ${input.tenantNames} (collectively, the "Tenant"), for the premises located at ${input.propertyAddress}, ${input.unitName} (the "Premises"), in the State of New York.`,
      input.otherOccupants
        ? `In addition to Tenant, the following individuals are authorized to occupy the Premises: ${input.otherOccupants}. Any additional occupant not named here or added consistent with New York's Roommate Law (Real Property Law § 235-f) requires Landlord's awareness as provided by that law.`
        : '',
      hasMultipleTenants(input.tenantNames)
        ? `Each person constituting Tenant is jointly and severally liable for all obligations under this Lease, including the full amount of rent and any damages, regardless of which individual(s) actually occupy the Premises at a given time.`
        : '',
    ].filter(Boolean),
  });

  sections.push({
    heading: '2. Term',
    body: [
      input.isRenewal
        ? `This Lease renews the tenancy at the Premises for a term beginning ${fmtDate(input.leaseStart)} and ending ${fmtDate(input.leaseEnd)}.`
        : `The term of this Lease begins ${fmtDate(input.leaseStart)} and ends ${fmtDate(input.leaseEnd)}, unless earlier terminated as provided by law or renewed by written agreement of both parties.`,
    ],
  });

  const rentParas = [`Tenant agrees to pay total monthly rent of ${fmtMoney(input.monthlyRent)}, due on the ${input.dueDay}${ordinalSuffix(input.dueDay)} day of each month.`];
  if (input.subsidyProgram && input.subsidyProgram !== 'none' && input.governmentPortion) {
    const programLabel = { section8: 'Section 8', cityfheps: 'CityFHEPS', hra: 'HRA' }[input.subsidyProgram];
    rentParas.push(
      `Of the total monthly rent, ${fmtMoney(input.governmentPortion)} is paid by ${programLabel} directly to Landlord, and the remaining ${fmtMoney(input.tenantPortion ?? 0)} is Tenant's portion.`,
    );
  }
  if (input.paymentMethod) rentParas.push(`Rent shall be paid by ${input.paymentMethod}.`);
  const lateFeeCap = lawfulLateFeeCap(input.monthlyRent);
  rentParas.push(
    `A late fee may be charged for rent not received within five (5) days of the due date, in an amount not to exceed ${fmtMoney(lateFeeCap)} (the lesser of $50 or 5% of monthly rent, the maximum permitted under New York Real Property Law § 238-a).`,
  );
  if (input.dishonoredPaymentFee) {
    rentParas.push(`A charge of ${fmtMoney(input.dishonoredPaymentFee)} applies to any dishonored (returned/bounced) rent payment, to the extent permitted by law.`);
  }
  sections.push({ heading: '3. Rent', body: rentParas });

  if (input.securityDeposit) {
    sections.push({
      heading: '4. Security Deposit',
      body: [
        `Tenant shall pay a security deposit of ${fmtMoney(input.securityDeposit)} prior to occupancy. In accordance with New York General Obligations Law § 7-103 and the Housing Stability and Tenant Protection Act of 2019, the security deposit shall not exceed one month's rent, shall be held in a segregated, interest-bearing account (where required by law) in a New York banking institution, and shall be returned to Tenant within fourteen (14) days after Tenant vacates the Premises, together with an itemized statement of any deductions for unpaid rent or damage beyond normal wear and tear.`,
        `Tenant acknowledges receipt of a copy of this security deposit provision and the bank/account information where the deposit is held, to be provided separately in writing as required by law.`,
      ],
    });
  }

  const utilityEntries = Object.entries(input.utilityAssignment).filter(([, v]) => v) as [string, UtilityPayer][];
  const utilitiesText = utilityEntries.length > 0
    ? utilityEntries.map(([u, payer]) => `${u}: paid by ${payer === 'landlord' ? 'Landlord' : 'Tenant'}`).join('; ') + '.'
    : `All utilities and services for the Premises are Tenant's responsibility, unless otherwise agreed in writing.`;
  sections.push({ heading: '5. Utilities and Services', body: [utilitiesText] });

  sections.push({
    heading: '6. Use of Premises',
    body: [
      `The Premises shall be used only as a private residence for Tenant and any occupants named above. Tenant shall not use or permit the Premises to be used for any short-term or transient rental purpose (including listing on Airbnb or similar platforms) or for any unlawful business or commercial use.`,
    ],
  });

  sections.push({
    heading: '7. Pets, Smoking, Alterations, and Locks',
    body: [
      input.petsAllowed
        ? `Pets are permitted subject to the following terms: ${input.petsPolicy || 'as separately agreed by the parties.'}`
        : `No pets of any kind are permitted on the Premises without Landlord's prior written consent.`,
      input.smokingAllowed ? `Smoking is permitted on the Premises.` : `Smoking is prohibited inside the Premises and in all common areas of the building.`,
      `Tenant shall not make alterations to the Premises, install additional appliances, or change, add, or re-key any lock without Landlord's prior written consent.`,
    ],
  });

  if (input.parkingIncluded || input.backyardAccess || input.garageOrBasementAccess) {
    const paras: string[] = [];
    if (input.parkingIncluded) paras.push(input.parkingDetails || 'A parking space is included as part of this Lease.');
    if (input.backyardAccess) paras.push(`Tenant has access to the backyard, subject to reasonable rules and shared use with other occupants of the building where applicable.`);
    if (input.garageOrBasementAccess) paras.push(`Tenant has access to the garage and/or basement area(s) as separately designated by Landlord, for the limited purposes agreed between the parties. ${input.commonAreaLimitations || ''}`.trim());
    sections.push({ heading: '8. Parking, Backyard, Garage, and Common Areas', body: paras });
  }

  sections.push({
    heading: '9. Tenant Maintenance Responsibilities',
    body: [
      `Tenant shall keep the Premises in a clean and sanitary condition, properly dispose of garbage and recycling in accordance with building and municipal requirements, and promptly notify Landlord in writing of any conditions requiring repair, including any signs of pests. Tenant shall cooperate with Landlord's pest control efforts and shall not do anything that contributes to a pest infestation.`,
    ],
  });

  sections.push({
    heading: '10. Smoke and Carbon Monoxide Detectors',
    body: [
      `The Premises is equipped with smoke and carbon monoxide detectors as required by New York law. Tenant shall not remove, disable, or tamper with any required detector and shall promptly notify Landlord if a detector is not functioning.`,
    ],
  });

  sections.push({
    heading: '11. Landlord Access',
    body: [
      `Landlord may enter the Premises to make repairs, inspections, or show the unit to prospective tenants or buyers upon reasonable notice to Tenant, generally not less than twenty-four (24) hours except in the case of emergency, in accordance with New York law.`,
    ],
  });

  sections.push({
    heading: '12. Subletting and Assignment',
    body: [
      `Any assignment or subletting of the Premises is subject to Landlord's consent and applicable New York law, including Real Property Law § 226-b where applicable.`,
    ],
  });

  if (input.insuranceRequired) {
    sections.push({
      heading: '13. Renter\u2019s Insurance',
      body: [`Tenant is required to obtain and maintain renter's insurance covering personal property and liability for the duration of the tenancy and to provide proof of coverage to Landlord upon request. Landlord's insurance does not cover Tenant's personal belongings.`],
    });
  }

  sections.push({
    heading: '14. Early Termination and Landlord\u2019s Duty to Mitigate',
    body: [
      `If Tenant vacates the Premises before the end of the Lease term without Landlord's consent, Tenant remains responsible for rent through the end of the term, except that Landlord shall use commercially reasonable efforts to re-rent the Premises and mitigate damages as required by New York law, and Tenant's liability shall be reduced by rent actually recovered from a replacement tenant.`,
    ],
  });

  sections.push({
    heading: '15. Holdover',
    body: [
      `If Tenant remains in the Premises after the end of the Lease term without a new written agreement, the tenancy shall continue on a month-to-month basis on the same terms, subject to applicable law. This provision is not intended to and shall not be construed as a penalty.`,
    ],
  });

  sections.push({
    heading: '16. Attorney\u2019s Fees',
    body: [
      `If either party brings a legal action to enforce this Lease, the prevailing party shall be entitled to recover reasonable attorney's fees and costs from the non-prevailing party. This provision is reciprocal as required by New York Real Property Law § 234.`,
    ],
  });

  sections.push({
    heading: '17. Notices',
    body: [
      `All notices required under this Lease shall be in writing and may be delivered by hand, mail, or, where both parties agree, by email or other electronic means to the addresses/contacts provided by the parties.`,
    ],
  });

  sections.push({
    heading: '18. No Waiver; Severability',
    body: [
      `Landlord's failure to enforce any provision of this Lease shall not be deemed a waiver of that provision. If any provision of this Lease is found invalid or unenforceable, the remaining provisions shall remain in full force and effect.`,
    ],
  });

  sections.push({
    heading: '19. Move-In / Move-Out Inspection',
    body: [
      `Landlord and Tenant shall complete a written move-in inspection report, with photographs, documenting the condition of the Premises prior to occupancy, and a corresponding move-out inspection report at the end of the tenancy. Both reports shall be retained with this Lease.`,
    ],
  });

  // --- Required / conditional statutory disclosures ---
  const disclosureHeadingPrefix = () => `Disclosure`;

  if (input.builtBefore1978) {
    sections.push({
      heading: `${disclosureHeadingPrefix()}: Lead-Based Paint (Federal Law)`,
      body: [
        `Housing built before 1978 may contain lead-based paint. Lead from paint, paint chips, and dust can pose health hazards if not managed properly. Landlord has provided Tenant with any available records and reports pertaining to lead-based paint and/or lead-based paint hazards in the Premises, and has provided Tenant with the EPA-approved pamphlet "Protect Your Family from Lead in Your Home." Tenant acknowledges receipt of this information as required by 42 U.S.C. § 4852d.`,
      ],
    });
  }

  sections.push({
    heading: `${disclosureHeadingPrefix()}: Bed Bug History`,
    body: [
      input.bedBugHistory
        ? `In accordance with New York Real Property Law § 231-b, Landlord discloses the following bed bug infestation history for the Premises and the building within the past year: ${input.bedBugDetails || 'see attached addendum.'}`
        : `In accordance with New York Real Property Law § 231-b, Landlord discloses that, to Landlord's knowledge, there is no history of bed bug infestation in the Premises within the past year, and no current infestation in the building.`,
    ],
  });

  if (input.windowGuardsRequired) {
    sections.push({
      heading: `${disclosureHeadingPrefix()}: Window Guards`,
      body: [`As required by the New York City Health Code, window guards will be installed in the Premises where a child or children age 10 or under reside, or upon written request of any tenant, at no cost to Tenant. Tenant shall not remove or interfere with required window guards.`],
    });
  }

  sections.push({
    heading: `${disclosureHeadingPrefix()}: Sprinkler System`,
    body: [
      input.sprinklerSystemPresent
        ? `Landlord discloses that the Premises/building is equipped with a fire sprinkler system.`
        : `Landlord discloses that the Premises/building is NOT equipped with a fire sprinkler system, to Landlord's knowledge.`,
    ],
  });

  if (input.stoveKnobCoversRequired) {
    sections.push({
      heading: `${disclosureHeadingPrefix()}: Stove Knob Covers`,
      body: [`Stove knob covers will be provided for the Premises' stove/range as applicable under local requirements for households with young children, upon request or as required.`],
    });
  }

  if (input.floodRisk) {
    sections.push({
      heading: `${disclosureHeadingPrefix()}: Flood History / Risk`,
      body: [
        `In accordance with New York Real Property Law § 462, Landlord discloses the following regarding flood history and/or flood risk for the Premises: ${input.floodRiskDetails || 'the Premises is located in an area of elevated flood risk; see FEMA flood maps for details.'}`,
      ],
    });
  }

  sections.push({
    heading: `${disclosureHeadingPrefix()}: Smoking Policy`,
    body: [
      input.smokingAllowed
        ? `As stated above, smoking is permitted on the Premises.`
        : `As stated above, smoking is prohibited on the Premises and in all common areas of the building, consistent with the building's smoke-free policy where applicable.`,
    ],
  });

  if (input.rentStabilized) {
    sections.push({
      heading: 'Rent Stabilization Notice',
      body: [
        `The Premises is subject to the Rent Stabilization Law and Code of the City of New York. Tenant's rights include, among others, the right to a renewal lease and protection from eviction except on grounds allowed by law. This Lease does not waive or diminish any right afforded to Tenant under the Rent Stabilization Law and Code.`,
      ],
    });
  }
  if (input.rentStabilizedRiderRequired) {
    sections.push({
      heading: 'Required Rider: DHCR Lease Rider for Rent-Stabilized Tenants',
      body: [
        `Because the Premises is rent-stabilized, the current DHCR "New York City Lease Rider for Rent Stabilized Tenants" (Form RA-LR1) must be attached to this Lease in a print size larger than this Lease, per DHCR requirements. The current official form is available at hcr.ny.gov/form-ralr1. This app does not generate that official form — obtain and attach the current version directly from DHCR before use.`,
      ],
    });
  }

  if (input.goodCauseApplies) {
    sections.push({
      heading: 'Good Cause Eviction Notice',
      body: [
        `This tenancy is subject to New York's Good Cause Eviction Law (Real Property Law Article 6-A, § 231-c). Under this law, Landlord may not refuse to renew this Lease or evict Tenant without "good cause" as defined by statute, and any rent increase above the threshold set by law may be subject to challenge as unreasonable.`,
        `The official "Notice to Tenant of Applicability or Inapplicability of the Good Cause Eviction Law" must be attached to this Lease as required by law. This app does not generate that official form — obtain the current version from the New York Courts system (nycourts.gov) and attach it separately.`,
      ],
    });
  } else if (input.goodCauseSmallLandlordExempt) {
    sections.push({
      heading: 'Good Cause Eviction Notice — Exemption Claimed',
      body: [
        `Landlord believes this tenancy is exempt from New York's Good Cause Eviction Law under the "small landlord" exemption (an owner of 10 or fewer units, per Real Property Law § 211), or another applicable statutory exemption. A completed official Notice to Tenant of Applicability or Inapplicability, marking the claimed exemption, must still be attached per New York Courts guidance (nycourts.gov) — Good Cause notice is required regardless of whether the law actually applies, and Landlord should confirm the specific exemption facts are accurate before relying on this.`,
      ],
    });
  }

  if (input.subsidyProgram && input.subsidyProgram !== 'none' && input.section8OrCityfhepsAddendumRequired) {
    const programLabel = { section8: 'Section 8 (HUD/HAP Tenancy Addendum)', cityfheps: 'CityFHEPS', hra: 'HRA' }[input.subsidyProgram];
    sections.push({
      heading: `Required Addendum: ${programLabel}`,
      body: [
        `This tenancy involves ${programLabel} assistance. The official program addendum/contract documents (e.g., the HUD Tenancy Addendum and Housing Assistance Payments contract for Section 8, or the equivalent CityFHEPS/HRA program documents) must be separately obtained, executed, and attached to this Lease. Those program documents control over any conflicting provision of this Lease.`,
      ],
    });
  }

  if (input.specialClauses) {
    sections.push({ heading: 'Additional Terms', body: [input.specialClauses] });
  }

  sections.push({
    heading: 'Default and Governing Law',
    body: [
      `In the event of a breach of this Lease by either party, the non-breaching party may pursue all remedies available under New York law. This Lease shall be governed by the laws of the State of New York.`,
    ],
  });

  sections.push({
    heading: 'Signatures',
    body: [
      `IN WITNESS WHEREOF, the parties have executed this Lease as of the date(s) below.`,
      `Landlord: _____________________________  Date: ____________`,
      `Tenant: _____________________________  Date: ____________`,
      hasMultipleTenants(input.tenantNames) ? `Additional Tenant: _____________________________  Date: ____________` : '',
    ].filter(Boolean),
  });

  return {
    title: `Residential Lease Agreement — ${input.propertyAddress}, ${input.unitName}`,
    landlordLabel: input.entityName || input.landlordName,
    sections,
  };
}

// This notice is mandatory on every generated document — no caller may omit
// it. Kept as an exported constant (not baked into the sections array) so
// the UI can render it visually distinctly (e.g. a highlighted box).
export const LEGAL_REVIEW_NOTICE =
  'This document was generated from a template covering common New York residential lease requirements. It is Claude\u2019s own template — not a reproduction of the REBNY lease or any other copyrighted form — and it is provided for convenience only. It is not legal advice and is not guaranteed to be complete, current, or enforceable for your specific property, building type, or locality. Several items (the official Good Cause Eviction notice, DHCR rent-stabilization rider, and Section 8/CityFHEPS program addenda) are separate official government forms that must be obtained and attached directly \u2014 this app does not generate those forms. Have a licensed New York attorney review this lease before use, particularly regarding rent stabilization status and Good Cause Eviction Law exemptions, which depend on building-specific facts.';
