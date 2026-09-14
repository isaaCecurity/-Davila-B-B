/// <reference types="jest" />
import type { OrganizationInvite } from '@bakeflow/types';

import { canInvite, inviteRecipient, invitableRolesFor, inviteView } from '../staffDisplay';

const base: OrganizationInvite = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'a@b.co',
  phone: null,
  status: 'pending',
  role_key: 'cashier',
  role_name: 'Cashier',
  branch_id: null,
  expires_at: '2026-09-20T10:00:00+00:00',
  accepted_at: null,
  created_at: '2026-09-13T10:00:00+00:00',
};

describe('inviteView', () => {
  const now = new Date('2026-09-14T10:00:00Z');
  it('shows a live pending invite as pending', () => {
    expect(inviteView(base, now).label).toBe('Pending');
  });
  it('shows a pending invite past its expiry as expired', () => {
    expect(inviteView({ ...base, expires_at: '2026-09-13T11:00:00+00:00' }, now).label).toBe('Expired');
  });
  it('keeps accepted and revoked as stored', () => {
    expect(inviteView({ ...base, status: 'accepted', accepted_at: '2026-09-13T12:00:00+00:00' }, now).label).toBe('Accepted');
    expect(inviteView({ ...base, status: 'revoked' }, now).label).toBe('Revoked');
  });
});

describe('invitableRolesFor (AD-026)', () => {
  const keys = (p: Parameters<typeof invitableRolesFor>[0]): string[] => invitableRolesFor(p).map((r) => r.key);
  it('lets a branch manager invite crew only', () => {
    expect(keys('manager')).toEqual(['cashier', 'baker', 'driver', 'supervisor']);
  });
  it('lets an owner invite every listed role and an admin all but admin', () => {
    expect(keys('owner')).toContain('branch_manager');
    expect(keys('owner')).toContain('admin');
    expect(keys('admin')).not.toContain('admin');
    expect(keys('admin')).toContain('branch_manager');
  });
  it('offers nothing to crew', () => {
    expect(keys('cashier')).toEqual([]);
    expect(canInvite('cashier')).toBe(false);
    expect(canInvite('manager')).toBe(true);
  });
});

describe('inviteRecipient', () => {
  it('reads the email, or the phone grouped', () => {
    expect(inviteRecipient({ email: 'a@b.co', phone: null })).toBe('a@b.co');
    expect(inviteRecipient({ email: null, phone: '+2348031234567' })).toBe('+234 803 123 4567');
  });
});
