import type { Profile, UserRole } from '../../lib/types';

/** Only owner/admin (and co-owners, who share role='owner') may use Admin. */
export function canAccessAdmin(role: UserRole | null | undefined): boolean {
  return role === 'owner';
}

export type RemoveDecision =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Rules for offboarding / deleting a portal profile from a portfolio.
 * - Never remove your own login.
 * - Never remove the primary portfolio owner (profile.id === portfolioOwnerId).
 * Co-owners (role=owner but id !== portfolioOwnerId) may be removed.
 */
export function canRemovePortalUser(args: {
  actorProfileId: string;
  portfolioOwnerId: string;
  target: Pick<Profile, 'id' | 'role'>;
}): RemoveDecision {
  const { actorProfileId, portfolioOwnerId, target } = args;
  if (!actorProfileId || !portfolioOwnerId || !target?.id) {
    return { ok: false, reason: 'Missing profile information.' };
  }
  if (target.id === actorProfileId) {
    return { ok: false, reason: 'You cannot remove your own login.' };
  }
  if (target.id === portfolioOwnerId) {
    return { ok: false, reason: 'Cannot remove the primary portfolio owner.' };
  }
  return { ok: true };
}

export function roleLabel(role: UserRole): string {
  if (role === 'owner') return 'Owner / admin';
  if (role === 'tenant') return 'Tenant';
  return 'Contractor';
}

export function isPrimaryPortfolioOwner(profileId: string, portfolioOwnerId: string): boolean {
  return profileId === portfolioOwnerId;
}
