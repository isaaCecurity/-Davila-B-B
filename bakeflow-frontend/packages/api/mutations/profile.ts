/**
 * Own profile — P9.9 Q8, `update_my_profile(p_full_name, p_phone)`.
 *
 * The signed-in person edits their own name (trimmed, 1–120 characters) and contact phone (E.164,
 * or empty to clear). The phone is the number the team sees and calls, not the sign-in phone. The
 * change is audited. The function, not the `profiles_update_self` policy, is the write path: that
 * policy refuses anyone whose home organization is not the active one (TECHNICAL_DEBT.md).
 */

import type { MyProfile } from '@bakeflow/types';
import { myProfileSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizeThrown } from '../errors';
import { parseRow, run } from '../internal/read';

export interface UpdateMyProfileInput {
  fullName: string;
  /** E.164 (`toE164Phone`), or null to clear. */
  phone: string | null;
}

/**
 * @throws {BakeflowApiError} `invalid_request` with reason `invalid_name` or `invalid_phone`;
 *   `insufficient_role` when not signed in.
 */
export async function updateMyProfile(client: BakeflowClient, input: UpdateMyProfileInput): Promise<MyProfile> {
  const name = input.fullName.trim();
  if (name.length < 1 || name.length > 120) {
    throw new BakeflowApiError({
      code: 'invalid_request',
      message: 'updateMyProfile: name must be 1 to 120 characters',
      details: JSON.stringify({ code: 'invalid_request', reason: 'invalid_name' }),
    });
  }
  const payload = await run(client.rpc('update_my_profile', { p_full_name: name, p_phone: input.phone ?? '' }));
  const parsed = parseRow(myProfileSchema, payload, 'updateMyProfile');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'updateMyProfile: the RPC returned no profile' });
  }
  return parsed;
}

/** The `avatars` bucket's limits (live `storage.buckets` row, read 2026-09-17). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export interface UploadMyAvatarInput {
  tenantId: string;
  userId: string;
  /** A local file URI from the image picker (or a blob: URL on web). */
  uri: string;
  mimeType: string;
  /** The photo being replaced, so the old file can be cleared out afterwards. */
  previousPath?: string | null;
}

/**
 * Best-effort removal of a profile photo file the caller uploaded (TD-021 rules: you may delete your
 * own file in `avatars`). Never throws — the profile has already been changed by the time this runs,
 * and a leftover file is not worth failing the action for.
 */
async function discardAvatarFile(client: BakeflowClient, objectPath: string | null | undefined): Promise<void> {
  if (objectPath === null || objectPath === undefined || objectPath === '') return;
  try {
    await client.storage.from('avatars').remove([objectPath]);
  } catch {
    /* the profile no longer points at it; an orphaned file is harmless */
  }
}

/**
 * Upload a new profile photo and make it yours — P9.9 Q9 (profile photo only).
 *
 * The file goes to the private `avatars` bucket at `<organization>/profiles/<user>/<unique>.<ext>` —
 * a new name every time, so nothing is overwritten — then `set_my_avatar()` checks that the object is
 * in your own folder and was uploaded by you, points your profile at it and audits the change.
 *
 * @throws {BakeflowApiError} `invalid_request` with reason `avatar_type` or `avatar_too_large` before
 *   any upload; the storage or RPC error otherwise.
 */
export async function uploadMyAvatar(client: BakeflowClient, input: UploadMyAvatarInput): Promise<MyProfile> {
  const ext = AVATAR_TYPES[input.mimeType];
  if (ext === undefined) {
    throw new BakeflowApiError({
      code: 'invalid_request',
      message: 'uploadMyAvatar: photos must be JPEG, PNG or WebP',
      details: JSON.stringify({ code: 'invalid_request', reason: 'avatar_type' }),
    });
  }
  let body: ArrayBuffer;
  try {
    body = await (await fetch(input.uri)).arrayBuffer();
  } catch (err) {
    throw normalizeThrown(err);
  }
  if (body.byteLength > AVATAR_MAX_BYTES) {
    throw new BakeflowApiError({
      code: 'invalid_request',
      message: 'uploadMyAvatar: photos must be 2 MB or smaller',
      details: JSON.stringify({ code: 'invalid_request', reason: 'avatar_too_large' }),
    });
  }
  const path = `${input.tenantId}/profiles/${input.userId}/avatar-${Date.now()}.${ext}`;
  const { error: uploadError } = await client.storage
    .from('avatars')
    .upload(path, body, { contentType: input.mimeType, upsert: false });
  if (uploadError !== null) {
    throw new BakeflowApiError({ code: 'unexpected_error', message: 'uploadMyAvatar: the photo could not be uploaded', cause: uploadError });
  }
  const payload = await run(client.rpc('set_my_avatar', { p_object_path: path }));
  const parsed = parseRow(myProfileSchema, payload, 'uploadMyAvatar');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'uploadMyAvatar: the RPC returned no profile' });
  }
  await discardAvatarFile(client, input.previousPath);
  return parsed;
}

/**
 * Remove your profile photo: the profile goes back to initials and the stored file is deleted.
 * `currentPath` is the photo being removed — pass it so the file does not linger in storage.
 */
export async function removeMyAvatar(client: BakeflowClient, currentPath?: string | null): Promise<MyProfile> {
  const payload = await run(client.rpc('set_my_avatar', { p_object_path: null }));
  const parsed = parseRow(myProfileSchema, payload, 'removeMyAvatar');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'removeMyAvatar: the RPC returned no profile' });
  }
  await discardAvatarFile(client, currentPath);
  return parsed;
}

/**
 * A short-lived URL for showing a stored photo (the bucket is private). Null when the photo cannot be
 * read from the active organization — the caller falls back to initials.
 */
export async function getAvatarUrl(client: BakeflowClient, objectPath: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await client.storage.from('avatars').createSignedUrl(objectPath, expiresInSeconds);
  if (error !== null || data === null) return null;
  return data.signedUrl;
}
