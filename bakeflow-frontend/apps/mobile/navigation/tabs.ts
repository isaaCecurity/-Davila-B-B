/**
 * Role-adaptive primary navigation, ported from the prototype's `ROLE_TABS`.
 *
 * The information architecture itself changes by role, not just visibility: a driver's bar
 * is built around logging tickets, a baker's around production.
 *
 * ## Advisory, never authoritative
 *
 * The role comes from the JWT `roles` claim (`rolesFromSession`), which `@bakeflow/auth`
 * documents as advisory — suitable for choosing a layout or hiding a control that would fail
 * anyway, never for deciding an action is permitted. Row-level security is the authority. A
 * deep link to a tab outside a role's bar still renders, and the database decides what that
 * screen can show.
 */

import type { IconName } from '@bakeflow/ui';

/** The prototype's personas, keyed to canonical roles (docs/PROTOTYPE-PORT.md, D3). */
export type Persona = 'owner' | 'manager' | 'cashier' | 'supervisor' | 'driver' | 'baker' | 'admin';

/** How each persona is named on screen. "Manager" means Branch Manager (CLAUDE.md). */
export const PERSONA_LABEL: Record<Persona, string> = {
  owner: 'Owner',
  manager: 'Branch manager',
  cashier: 'Cashier',
  supervisor: 'Supervisor',
  driver: 'Driver',
  baker: 'Baker',
  admin: 'Admin',
};

/** Live `roles.key` → persona. */
const PERSONA_BY_ROLE: Record<string, Persona> = {
  owner: 'owner',
  admin: 'admin',
  branch_manager: 'manager',
  supervisor: 'supervisor',
  baker: 'baker',
  cashier: 'cashier',
  driver: 'driver',
};

/** `roles.rank` from the live table — lower is more senior. */
const RANK: Record<string, number> = {
  owner: 1,
  admin: 2,
  branch_manager: 3,
  supervisor: 4,
  baker: 9,
  cashier: 10,
  driver: 11,
};

/**
 * The persona for a set of role keys: the most senior recognised role wins, so an owner
 * who also drives sees the owner's bar. No recognised role falls back to the minimal bar.
 */
export function personaFor(roleKeys: readonly string[]): Persona {
  const known = roleKeys.filter((k) => k in PERSONA_BY_ROLE);
  if (known.length === 0) return 'admin';
  const senior = known.reduce((a, b) => ((RANK[a] ?? 99) <= (RANK[b] ?? 99) ? a : b));
  return PERSONA_BY_ROLE[senior] ?? 'admin';
}

/** Route file names inside `app/(tabs)/`. */
export const TAB_ROUTES = [
  'index',
  'orders',
  'sales',
  'finance',
  'cash',
  'my-sales',
  'my-cash',
  'operations',
  'staff',
  'route',
  'tickets',
  'production',
  'alerts',
  'more',
] as const;

export type TabRoute = (typeof TAB_ROUTES)[number];

export const TAB_DEFS: Record<TabRoute, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  orders: { label: 'Orders', icon: 'orders' },
  sales: { label: 'Sales', icon: 'sales' },
  finance: { label: 'Finance', icon: 'finance' },
  cash: { label: 'Cash', icon: 'cash' },
  'my-sales': { label: 'Sales', icon: 'sales' },
  'my-cash': { label: 'Cash', icon: 'cash' },
  operations: { label: 'Operations', icon: 'layers' },
  staff: { label: 'Staff', icon: 'users' },
  route: { label: 'Routes', icon: 'truck' },
  tickets: { label: 'Tickets', icon: 'ticket' },
  production: { label: 'Production', icon: 'flame' },
  alerts: { label: 'Alerts', icon: 'bell' },
  more: { label: 'More', icon: 'grid' },
};

/*
 * PORT-NOTE: the prototype ends the Cashier, Supervisor and Baker bars with a "More" tab that
 * opens its `settings` screen, and Owner/Manager/Driver with its `more` screen. Both are
 * labelled More with the grid icon, so they share one `more` route here; that screen decides
 * which menu to show from the persona.
 */
export const PERSONA_TABS: Record<Persona, readonly TabRoute[]> = {
  owner: ['index', 'orders', 'sales', 'finance', 'more'],
  manager: ['index', 'orders', 'sales', 'cash', 'more'],
  cashier: ['index', 'my-sales', 'my-cash', 'more'],
  supervisor: ['index', 'operations', 'staff', 'more'],
  driver: ['index', 'route', 'tickets', 'more'],
  baker: ['index', 'production', 'alerts', 'more'],
  admin: ['index'],
};
