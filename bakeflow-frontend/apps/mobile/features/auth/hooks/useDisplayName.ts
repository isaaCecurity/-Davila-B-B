import { getSupabaseClient } from '@bakeflow/auth';
import { useAvatarUrl, useMyProfile } from '@bakeflow/hooks';

import { useSessionStore } from '../../../stores/session';

/**
 * The signed-in person's name as the team sees it: the saved profile name (P9.9 Q8), else the name
 * given at sign-up, else their email or phone. `named` is false when only a contact detail is known.
 * `photo` is a signed URL for the profile photo (P9.9 Q9), or null to show initials.
 */
export function useDisplayName(): { name: string; named: boolean; contact: string; photo: string | null } {
  const session = useSessionStore((s) => s.session);
  const userId = useSessionStore((s) => s.userId);
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const profile = useMyProfile(getSupabaseClient(), userId);
  const photo = useAvatarUrl(getSupabaseClient(), tenantId, profile.data?.avatar_url);
  const saved = profile.data?.full_name?.trim() ?? '';
  const signUp = ((session?.user.user_metadata?.['full_name'] as string | undefined) ?? '').trim();
  const email = session?.user.email ?? '';
  const phone = session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : '';
  const contact = email !== '' ? email : phone;
  const name = saved !== '' ? saved : signUp;
  return { name: name !== '' ? name : contact, named: name !== '', contact, photo: photo.data ?? null };
}
