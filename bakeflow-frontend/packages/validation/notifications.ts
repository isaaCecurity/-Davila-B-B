import { NOTIFICATION_KINDS } from '@bakeflow/types';
import { z } from 'zod';

import { timestamptzSchema, uuidSchema } from './decimal';

/** Mirrors a `notifications` row as the app selects it (P9.9 Q5). */
export const appNotificationSchema = z.object({
  id: uuidSchema,
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string().nullable(),
  route: z.string().nullable(),
  entity_type: z.string().nullable(),
  entity_id: uuidSchema.nullable(),
  branch_id: uuidSchema.nullable(),
  read_at: timestamptzSchema.nullable(),
  created_at: timestamptzSchema,
});
