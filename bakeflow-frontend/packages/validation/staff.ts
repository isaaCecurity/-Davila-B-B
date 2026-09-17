/**
 * Zod schema for the driver-picker read model — P9.6.
 *
 * See `@bakeflow/types` `staff.ts` for why the shape is this narrow: `status` is filtered
 * server-side rather than carried, and `branch_id` is omitted because `transition_delivery`
 * assigns tenant-wide, not per-branch.
 */

import { z } from 'zod';

import { INVITE_STATUSES, PROFILE_STATUSES } from '@bakeflow/types';

import { timestamptzSchema, uuidSchema } from './decimal';

export const driverSchema = z.object({
  profile_id: uuidSchema,
  full_name: z.string().min(1),
  phone: z.string().nullable(),
});

export const staffRoleSchema = z.object({
  user_role_id: uuidSchema,
  profile_id: uuidSchema,
  full_name: z.string(),
  phone: z.string().nullable(),
  status: z.enum(PROFILE_STATUSES),
  role_key: z.string().min(1),
  role_name: z.string().min(1),
  role_rank: z.number().int(),
  branch_id: uuidSchema.nullable(),
  created_at: timestamptzSchema,
});

export const organizationInviteSchema = z.object({
  id: uuidSchema,
  // AD-026: exactly one of email / phone (live CHECK organization_invites_one_contact).
  email: z.string().min(3).nullable(),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable(),
  status: z.enum(INVITE_STATUSES),
  role_key: z.string().min(1),
  role_name: z.string().min(1),
  branch_id: uuidSchema.nullable(),
  expires_at: timestamptzSchema,
  accepted_at: timestamptzSchema.nullable(),
  created_at: timestamptzSchema,
});

/**
 * An invitation address, checked before `create_organization_invite()` is called. Stricter than
 * the live CHECK (`position('@' in email) > 1`) on purpose: a typo'd address is an invite that
 * can never arrive. The database remains the authority.
 */
export const inviteEmailSchema = z.email();

export const auditEventSchema = z.object({
  id: uuidSchema,
  actor_id: uuidSchema.nullable(),
  entity_type: z.string(),
  entity_id: uuidSchema.nullable(),
  action: z.string(),
  occurred_at: timestamptzSchema,
});

/** The signed-in person's own profile (`profiles` read, `update_my_profile()` result). */
export const myProfileSchema = z.object({
  id: uuidSchema,
  full_name: z.string(),
  phone: z.string().nullable(),
  avatar_url: z.string().nullable(),
});
