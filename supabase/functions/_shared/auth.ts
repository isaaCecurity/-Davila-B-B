import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.ts';

export interface CallerContext {
  userId: string;
  email: string | null;
  activeTenantId: string | null;
  roles: string[];
}

export function getServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(
      500,
      'configuration_error',
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function authenticateCaller(req: Request): Promise<{
  context: CallerContext;
  serviceClient: SupabaseClient;
}> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'unauthorized', 'Missing or invalid Authorization header');
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const serviceClient = getServiceClient();

  const {
    data: { user },
    error: authError,
  } = await serviceClient.auth.getUser(token);

  if (authError || !user) {
    throw new HttpError(401, 'unauthorized', 'Invalid or expired access token', authError?.message);
  }

  // Parse JWT claims
  let activeTenantId: string | null = null;
  let roles: string[] = [];

  try {
    const payloadBase64 = token.split('.')[1];
    if (payloadBase64) {
      // Decode JWT payload
      const binaryStr = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const decodedPayload = JSON.parse(new TextDecoder().decode(bytes));

      if (decodedPayload.tenant_id && typeof decodedPayload.tenant_id === 'string') {
        activeTenantId = decodedPayload.tenant_id;
      }
      if (Array.isArray(decodedPayload.roles)) {
        roles = decodedPayload.roles;
      }
    }
  } catch (err) {
    console.warn('[auth.ts] Could not parse JWT claims for extra context:', err);
  }

  return {
    context: {
      userId: user.id,
      email: user.email ?? null,
      activeTenantId,
      roles,
    },
    serviceClient,
  };
}

export async function assertCallerTenantMembership(
  serviceClient: SupabaseClient,
  userId: string,
  targetTenantId: string
): Promise<{ isMember: boolean; roles: string[] }> {
  const { data, error } = await serviceClient
    .from('user_roles')
    .select('roles(name)')
    .eq('profile_id', userId)
    .eq('tenant_id', targetTenantId)
    .is('deleted_at', null);

  if (error) {
    throw new HttpError(500, 'database_error', 'Failed to verify organization membership', error.message);
  }

  if (!data || data.length === 0) {
    throw new HttpError(
      403,
      'forbidden',
      'Caller is not an active member of the target organization'
    );
  }

  const roleNames = data
    .map((r: any) => r.roles?.name)
    .filter((name: any): name is string => typeof name === 'string');

  return {
    isMember: true,
    roles: roleNames,
  };
}
