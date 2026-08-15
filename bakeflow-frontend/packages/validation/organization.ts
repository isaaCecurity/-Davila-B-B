/**
 * Zod schemas for the organization read models — P8.1.
 *
 * Mirrors the live columns verified 2026-08-15. `organizations` has no `NUMERIC` column,
 * so no `::text` cast and no branded decimal appears here.
 *
 * `status` is `z.string()` rather than an enum: the live column is `TEXT NOT NULL` and no
 * CHECK on it was read, so narrowing it would make the reader stricter than the database —
 * the failure that would blank the entire organization switcher over one unexpected value,
 * on the screen a user has no way to navigate past.
 */

import { z } from 'zod';

import { timestamptzSchema, uuidSchema } from './decimal';

export const organizationMembershipSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  status: z.string(),
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
});

/**
 * One `user_roles` row with its `roles` lookup flattened.
 *
 * The embed arrives as `roles: { key, name, rank }`. It is flattened in the query rather
 * than here so the read model stays flat for consumers; this schema validates the flat
 * shape the query produces.
 */
export const organizationRoleSchema = z.object({
  tenant_id: uuidSchema,
  role_key: z.string().min(1),
  role_name: z.string().min(1),
  role_rank: z.number().int(),
  branch_id: uuidSchema.nullable(),
});
