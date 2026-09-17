import { BakeflowApiError, errorReason } from '@bakeflow/api';
import { getSupabaseClient, rolesFromSession } from '@bakeflow/auth';
import { useMyProfile, useRemoveMyAvatar, useStaffRoles, useUpdateMyProfile, useUploadMyAvatar, useWarehouses } from '@bakeflow/hooks';
import {
  Avatar,
  Button,
  Callout,
  Card,
  Field,
  GroupLabel,
  Icon,
  IconTile,
  List,
  ListRow,
  Menu,
  MenuItem,
  PressableScale,
  ScreenScroll,
  Sheet,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatPhone, toE164Phone } from '@bakeflow/validation';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useDisplayName } from '../features/auth/hooks/useDisplayName';
import { pickAvatar } from '../features/profile/pickAvatar';
import { useActiveOrganization } from '../features/organization/hooks/useActiveOrganization';
import { useSessionStore } from '../stores/session';
import { toast } from '../stores/ui/toast.store';

function describe(error: Error): string {
  const reason = errorReason(error);
  if (reason === 'invalid_name') return 'Enter your name — up to 120 characters.';
  if (reason === 'invalid_phone') return 'Enter the full phone number, like 0803 123 4567, or leave it empty.';
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  if (code === 'network_unavailable') return 'No connection. Your details were not saved.';
  return 'Your details were not saved. Try again.';
}

function describePhoto(error: Error): string {
  const reason = errorReason(error);
  if (reason === 'avatar_too_large') return 'That photo is larger than 2 MB. Choose a smaller one, or crop it closer.';
  if (reason === 'avatar_type') return 'Use a JPEG, PNG or WebP photo.';
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  if (code === 'network_unavailable') return 'No connection. Your photo was not changed.';
  return 'Your photo was not changed. Try again.';
}

/**
 * Account — the prototype's `account`: your avatar and name with an Edit button, then Branch, Role
 * and Bakery.
 *
 * Name and contact phone come from your own `profiles` row and are edited through
 * `update_my_profile()` (P9.9 Q8, audited). Roles come from your own `user_roles` rows, branch names
 * from the stockrooms you can see.
 *
 * The "+" on the avatar is the prototype's "Upload photo": choose or take a square photo, uploaded to the
 * private `avatars` bucket and set by `set_my_avatar()` (P9.9 Q9, audited); Remove goes back to initials.
 *
 * PORT-NOTE: the prototype's Edit opens name editing only (a toast in the prototype); here it opens a
 * sheet for name and contact phone, because the phone is what the team calls from Staff. The contact
 * phone is not the sign-in phone. A photo is readable from the organization it was uploaded under; in
 * another organization the initials show until a photo is uploaded there.
 */
export default function AccountScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const org = useActiveOrganization();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const session = useSessionStore((s) => s.session);
  const userId = useSessionStore((s) => s.userId);
  const display = useDisplayName();
  const profile = useMyProfile(client, userId);
  const update = useUpdateMyProfile(client, userId, tenantId);
  const upload = useUploadMyAvatar(client, userId);
  const removePhoto = useRemoveMyAvatar(client, userId);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const roles = useStaffRoles(client, tenantId);
  const warehouses = useWarehouses(client, tenantId);

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');

  const mine = useMemo(() => (roles.data ?? []).filter((r) => r.profile_id === userId), [roles.data, userId]);
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses.data ?? []) if (!map.has(w.branch_id)) map.set(w.branch_id, w.name);
    return map;
  }, [warehouses.data]);
  const tokenRoles = rolesFromSession(session);

  const uniqueRoles = [...new Map(mine.map((r) => [`${r.role_key}:${r.branch_id ?? ''}`, r])).values()];
  const roleLine = uniqueRoles.length > 0 ? [...new Set(uniqueRoles.map((r) => r.role_name))].join(', ') : tokenRoles.join(', ');
  const branchLine = uniqueRoles.length === 0
    ? '—'
    : [...new Set(uniqueRoles.map((r) => (r.branch_id === null ? 'Whole bakery' : (branchName.get(r.branch_id) ?? 'Branch'))))].join(', ');

  const trimmedName = nameDraft.trim();
  const phoneE164 = toE164Phone(phoneDraft);
  const phoneOk = phoneDraft.trim() === '' || phoneE164 !== null;
  const nameOk = trimmedName.length >= 1 && trimmedName.length <= 120;

  function openEdit(): void {
    setNameDraft(profile.data?.full_name ?? (display.named ? display.name : ''));
    setPhoneDraft(profile.data?.phone ? formatPhone(profile.data.phone) : '');
    update.reset();
    setEditing(true);
  }

  async function choosePhoto(source: 'library' | 'camera'): Promise<void> {
    if (tenantId === null || userId === null) return;
    setPhotoNote(null);
    upload.reset();
    const picked = await pickAvatar(source);
    if (picked === null) return;
    if ('denied' in picked) {
      setPhotoNote(source === 'camera' ? 'Camera access is off for BakeFlow. Turn it on in your phone settings.' : 'Photo access is off for BakeFlow. Turn it on in your phone settings.');
      return;
    }
    upload.mutate(
      { tenantId, userId, uri: picked.uri, mimeType: picked.mimeType },
      {
        onSuccess: () => {
          setPhotoSheet(false);
          toast({ tone: 'success', title: 'Photo updated' });
        },
      }
    );
  }

  function save(): void {
    if (!nameOk || !phoneOk) return;
    update.mutate(
      { fullName: trimmedName, phone: phoneDraft.trim() === '' ? null : phoneE164 },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ tone: 'success', title: 'Details saved' });
        },
      }
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll title="Account" onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}>
        <Card className="mt-2 px-4 py-4">
          <View className="flex-row items-center gap-3">
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={profile.data?.avatar_url ? 'Change or remove profile photo' : 'Upload profile photo'}
              onPress={() => {
                upload.reset();
                removePhoto.reset();
                setPhotoNote(null);
                setPhotoSheet(true);
              }}
              scaleTo={0.95}
            >
              <Avatar name={display.name} uri={display.photo} size="lg" />
              <View className="absolute -bottom-1 -left-1 h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white bg-cream-deep">
                <Icon name="plus" size={13} color="cocoa" />
              </View>
            </PressableScale>
            <View className="min-w-0 flex-1">
              {profile.isLoading ? (
                <Skeleton variant="row" className="h-6 w-40" />
              ) : (
                <Text className="text-title-3 font-semibold tracking-[-0.3px] text-cocoa" numberOfLines={1}>{display.name}</Text>
              )}
              {display.named && display.contact !== '' && (
                <Text variant="meta" numberOfLines={1}>{display.contact}</Text>
              )}
            </View>
            <Button label="Edit" tone="secondary" onPress={openEdit} />
          </View>
        </Card>

        <GroupLabel>Details</GroupLabel>
        {roles.isLoading ? (
          <Skeleton variant="row" />
        ) : (
          <List>
            <ListRow leading={<IconTile icon="store" size="sm" />} title="Branch" sub={branchLine} chevron={false} />
            <ListRow leading={<IconTile icon="user" size="sm" />} title="Role" sub={roleLine === '' ? 'No role in this bakery' : roleLine} chevron={false} />
            <ListRow leading={<IconTile icon="doc" size="sm" />} title="Bakery" sub={org?.name ?? 'None selected'} chevron={false} />
            <ListRow
              leading={<IconTile icon="phone" size="sm" />}
              title="Contact phone"
              sub={profile.data?.phone ? formatPhone(profile.data.phone) : 'Not added'}
              chevron={false}
            />
          </List>
        )}
      </ScreenScroll>

      <Sheet visible={photoSheet} onClose={() => setPhotoSheet(false)} title="Profile photo">
        <View className="gap-4">
          <Menu>
            <MenuItem icon="grid" title="Choose a photo" onPress={() => void choosePhoto('library')} />
            <MenuItem icon="camera" title="Take a photo" onPress={() => void choosePhoto('camera')} />
          </Menu>
          {upload.isPending && <Text variant="caption">Uploading…</Text>}
          {photoNote !== null && <Callout tone="warning" title="Can't open photos" detail={photoNote} />}
          {upload.isError && <Callout tone="error" title="Photo not changed" detail={describePhoto(upload.error)} />}
          {removePhoto.isError && <Callout tone="error" title="Photo not removed" detail={describePhoto(removePhoto.error)} />}
          {profile.data?.avatar_url ? (
            <Button
              label="Remove photo"
              tone="danger"
              busy={removePhoto.isPending}
              disabled={upload.isPending}
              onPress={() =>
                removePhoto.mutate(undefined, {
                  onSuccess: () => {
                    setPhotoSheet(false);
                    toast({ tone: 'neutral', title: 'Photo removed' });
                  },
                })
              }
              block
            />
          ) : null}
        </View>
      </Sheet>

      <Sheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="Your details"
        foot={<Button label="Save" busy={update.isPending} disabled={!nameOk || !phoneOk} onPress={save} block />}
      >
        <View className="gap-4">
          <Field
            label="Name"
            value={nameDraft}
            onChangeText={setNameDraft}
            autoComplete="name"
            autoCapitalize="words"
            placeholder="As your team knows you"
            maxLength={120}
            error={nameDraft !== '' && !nameOk ? 'Enter your name' : null}
          />
          <Field
            label="Contact phone"
            value={phoneDraft}
            onChangeText={setPhoneDraft}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="0803 123 4567"
            error={phoneOk ? null : 'Enter the full number, like 0803 123 4567'}
            hint={phoneE164 !== null ? `Saved as ${formatPhone(phoneE164)}. Shown to your team; it does not change how you sign in.` : 'Optional. Shown to your team; it does not change how you sign in.'}
          />
          {update.isError && <Callout tone="error" title="Not saved" detail={describe(update.error)} />}
        </View>
      </Sheet>
    </View>
  );
}
