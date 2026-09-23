// ---------------------------------------------------------------------------
// A garage/parking space rented on its own is a license to use space, not a
// residential tenancy — it doesn't carry lead paint, bed bug, window guard,
// or Good Cause Eviction disclosures the way an apartment lease does. Kept
// as its own template/document type rather than a rider on the residential
// lease so those disclosures aren't wrongly implied to apply. Same pure
// function shape as buildLeaseDocument for consistency and testability.
// ---------------------------------------------------------------------------

export interface GarageDocInput {
  landlordName: string;
  entityName?: string;
  propertyAddress: string;
  spaceName: string; // e.g. "62 Fillmore Garage"
  renterName: string;
  leaseStart: string;
  leaseEnd: string;
  isMonthToMonth: boolean;
  monthlyRent: number;
  dueDay: number;
  securityDeposit?: number;
  permittedUse: string; // e.g. "parking one passenger vehicle" / "storage only"
  vehicleInfo?: string; // make/model/plate, if a vehicle
  accessDetails?: string;
  specialClauses?: string;
}

export interface LeaseSection {
  heading: string;
  body: string[];
}

export interface GarageDocument {
  title: string;
  landlordLabel: string;
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

export function buildGarageDocument(input: GarageDocInput): GarageDocument {
  const landlordLabel = input.entityName ? `${input.entityName} (the "Owner")` : `${input.landlordName} (the "Owner")`;
  const sections: LeaseSection[] = [];

  sections.push({
    heading: '1. Parties and Space',
    body: [
      `This Garage/Parking Space Rental Agreement ("Agreement") is entered into between ${landlordLabel} and ${input.renterName} (the "Renter"), for the use of ${input.spaceName}, located at ${input.propertyAddress} (the "Space"), in the State of New York.`,
      `This Agreement is a license to use the Space for the purpose stated below. It is NOT a residential lease and does not grant Renter any tenancy or possessory rights in the Space or the property beyond that limited use.`,
    ],
  });

  sections.push({
    heading: '2. Term',
    body: [
      input.isMonthToMonth
        ? `This Agreement begins ${fmtDate(input.leaseStart)} and continues on a month-to-month basis until terminated by either party with thirty (30) days' written notice.`
        : `The term of this Agreement begins ${fmtDate(input.leaseStart)} and ends ${fmtDate(input.leaseEnd)}.`,
    ],
  });

  sections.push({
    heading: '3. Rent',
    body: [
      `Renter agrees to pay ${fmtMoney(input.monthlyRent)} per month, due on the ${input.dueDay}${ordinalSuffix(input.dueDay)} day of each month.`,
    ],
  });

  if (input.securityDeposit) {
    sections.push({
      heading: '4. Security Deposit',
      body: [`Renter shall pay a security deposit of ${fmtMoney(input.securityDeposit)}, refundable upon satisfactory condition of the Space at the end of this Agreement, less any amounts owed for unpaid rent or damage.`],
    });
  }

  sections.push({
    heading: 'Permitted Use',
    body: [
      `The Space may be used only for: ${input.permittedUse}.`,
      input.vehicleInfo ? `Vehicle information on file: ${input.vehicleInfo}.` : '',
      `No hazardous materials, flammable substances, or illegal items may be stored in the Space. No repairs, mechanical work, or commercial activity may be conducted in the Space without Owner's prior written consent.`,
    ].filter(Boolean),
  });

  if (input.accessDetails) {
    sections.push({ heading: 'Access', body: [input.accessDetails] });
  }

  sections.push({
    heading: 'Liability',
    body: [
      `Owner is not responsible for damage to, or theft of, any vehicle or property stored in the Space. Renter uses the Space at Renter's own risk and is encouraged to maintain appropriate insurance.`,
    ],
  });

  sections.push({
    heading: 'Termination',
    body: [
      `Either party may terminate this Agreement as provided above. Owner may terminate immediately for nonpayment of rent or use of the Space for a purpose other than as permitted above.`,
    ],
  });

  if (input.specialClauses) {
    sections.push({ heading: 'Additional Terms', body: [input.specialClauses] });
  }

  sections.push({
    heading: 'Governing Law',
    body: [`This Agreement shall be governed by the laws of the State of New York.`],
  });

  sections.push({
    heading: 'Signatures',
    body: [
      `IN WITNESS WHEREOF, the parties have executed this Agreement as of the date(s) below.`,
      `Owner: _____________________________  Date: ____________`,
      `Renter: _____________________________  Date: ____________`,
    ],
  });

  return {
    title: `Garage/Parking Space Rental Agreement — ${input.spaceName}`,
    landlordLabel: input.entityName || input.landlordName,
    sections,
  };
}

export const GARAGE_LEGAL_REVIEW_NOTICE =
  'This document was generated from a template for a simple garage/parking space rental and is Claude\u2019s own template, not a copyrighted third-party form. It is provided for convenience only, is not legal advice, and is not guaranteed to be complete, current, or enforceable for your specific situation. If the renter is also a residential tenant in the building, consider whether this arrangement should instead be a rider to that residential lease rather than a standalone agreement. Have a licensed New York attorney review before use.';
