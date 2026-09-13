/// <reference types="jest" />
import type { OrganizationInvite } from '@bakeflow/types';

import { inviteView } from '../staffDisplay';

const base: OrganizationInvite = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'a@b.co',
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
