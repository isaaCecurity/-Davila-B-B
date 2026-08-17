/**
 * Sales read service — P4.4a (customers) and P4.4b (tickets). **Read path only.**
 *
 * ## Mechanism: PostgREST + RLS, not RPCs
 *
 * Same rule as catalog, inventory and production (`API-CONTRACT.md` §1): reads and simple
 * filtered lists go through PostgREST protected by RLS; RPCs are reserved for operations
 * that must be atomic. No sales *read* RPC exists and none should be written.
 *
 * ## Why the write path is absent, and what it will have to be
 *
 * Ticket mutation is a state machine, not a set of column updates. Since the 2026-08-14
 * migration `drop_prevent_submitted_ticket_update_and_harden_guard`,
 * `guard_ticket_status_transition()` is the **sole** authority on `tickets.status` and also
 * freezes `subtotal_amount` the moment a ticket leaves `draft`. `API-CONTRACT.md` names
 * `confirm_ticket()`, `complete_ticket()`, `cancel_ticket()` and `archive_ticket()` as the
 * RPCs that drive it — each taking a `p_order_id` that is really a `tickets.id`.
 *
 * **Those signatures have not been read from the live database, so no mutation is written
 * here.** The `adjust_stock()` episode is the precedent: P4.2b assumed a direct insert with
 * a delta quantity, the live function turned out to be a SECURITY DEFINER RPC taking an
 * absolute target, and a complete implementation was discarded rather than shipped. A
 * mutation contract is read from the database or it is not written.
 *
 * Two further reasons the ticket write path is not merely "not done yet":
 *
 * - `discount_amount` and `tax_amount` have no approved rules (**BLOCKER-003**). Anything
 *   that set them would be inventing financial policy.
 * - `draft → submitted` has **no RPC at all** (`API-CONTRACT.md` §2), so that one hop is an
 *   unresolved contract question rather than a missing call.
 *
 * ## Provenance
 *
 * Types, schemas and the column sets below were written from `SCHEMA-REFERENCE.md` §4 and
 * `STATE-MACHINES.md` §1, **not** from a live `information_schema` read: the Supabase
 * connector available to this session is authorized against a different Supabase account
 * and answers *"You do not have permission to perform this action"* for project
 * `tvfyxpafbpnkneujcnvr` (**BLOCKER-011**). The queries therefore assert no RLS predicate —
 * they filter what they need explicitly and let the server decide what is visible.
 *
 * ## Money precision
 *
 * Seven money columns and one quantity column across the two ticket tables, every one
 * `::text` cast. The projection is derived from the Zod schema by `projectionFor`, so a
 * column cannot be selected without its cast and the two cannot drift. See
 * `@bakeflow/types` `scalars.ts` for the executed evidence that JSON transport otherwise
 * destroys `NUMERIC` scale.
 *
 * **Nothing here computes a total.** Not `line_total`, not `total_amount`, not an order
 * value summed across a page. Those are database facts (`recalculate_ticket_totals()`, a
 * `GENERATED ALWAYS` column, and the `payments` ledger respectively), and reproducing them
 * in JavaScript would require float arithmetic on money.
 */

import type {
  Customer,
  Ticket,
  TicketFulfilmentType,
  TicketItem,
  TicketStatus,
  TicketWithItems,
  Uuid,
} from '@bakeflow/types';
import { customerSchema, ticketItemSchema, ticketSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import {
  chunk,
  decodeCursor,
  encodeCursor,
  IN_CLAUSE_CHUNK,
  parseRow,
  parseRows,
  projectionFor,
  quoteFilterValue,
  resolveLimit,
  run,
  withSoftDeleteFilter,
  type Page,
  type PageOptions,
  type ReadEntity,
  type SchemaShape,
} from '../internal/read';

/* -------------------------------------------------------------------------- */
/* Column projections, derived from the schemas                                */
/* -------------------------------------------------------------------------- */

/**
 * Every `NUMERIC` column across the three sales tables.
 *
 * `customers` contributes none — it holds no money and no quantity, which is why a
 * customer list is the one read in this domain with no precision hazard at all.
 */
const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set([
  'subtotal_amount',
  'discount_amount',
  'tax_amount',
  'total_amount',
  'amount_paid',
  'quantity',
  'unit_price',
  'line_total',
]);

/**
 * `revision` is **not** in that set, and that is deliberate.
 *
 * It is `BIGINT`, so PostgREST renders it unquoted and `JSON.parse` has already produced a
 * `number` before any code here runs — exactly the transport defect the `::text` casts
 * exist to defeat. Casting it would only convert an already-parsed integer into a string
 * for no benefit, and `ticketSchema` types it as `z.number().int()` to match. The reason
 * this is safe for `revision` and catastrophic for money is scale: a per-ticket edit
 * counter cannot approach 2^53, whereas `NUMERIC(19,4)` routinely carries digits a double
 * cannot hold.
 */
const CUSTOMERS: ReadEntity<Customer> = {
  table: 'customers',
  schema: customerSchema,
  columns: projectionFor(customerSchema, TEXT_CAST_COLUMNS),
  // `SOFT-DELETE-AND-RETENTION.md` §5 gives `customers` as its worked example of the
  // `deleted_at IS NULL` read pattern, and §10 lists it among the three entities eligible
  // for the two-step permanent-delete flow — both of which require the column.
  softDeleted: true,
};

/**
 * `ticketSchema` is a `ZodObject` wrapped in `.refine()` (the `cancelled_reason` rule), so
 * its `.shape` is reachable but not through the `SchemaShape` structural type — the same
 * situation `productionBatchSchema` is in, and handled the same way: the cast is confined
 * to the `projectionFor` argument, never applied to `schema` itself.
 *
 * Do not widen it into a cast on `schema`. That would silence the compiler on the one
 * thing worth checking here, which is that the schema's output type really is `Ticket`.
 */
const TICKETS: ReadEntity<Ticket> = {
  table: 'tickets',
  schema: ticketSchema,
  columns: projectionFor(ticketSchema as unknown as SchemaShape, TEXT_CAST_COLUMNS),
  // §4 lists `[std] + deleted_at, deleted_by` for `tickets` explicitly.
  softDeleted: true,
};

/**
 * `ticket_items` **does** carry `deleted_at`, despite §4 listing `[std]` alone for it.
 *
 * Verified live 2026-08-15, along with its SELECT policy, which is the most interesting one
 * in the domain:
 *
 * ```sql
 * tenant_id = current_tenant_id()
 *   AND deleted_at IS NULL
 *   AND EXISTS (SELECT 1 FROM tickets o
 *                WHERE o.id = ticket_items.ticket_id
 *                  AND o.tenant_id = ticket_items.tenant_id
 *                  AND has_branch_access(o.branch_id))
 * ```
 *
 * The table has no `branch_id` of its own, so branch isolation reaches **through the parent
 * ticket**. A line is invisible whenever its ticket is — which is why `getTicketWithItems`
 * returning `null` for an invisible ticket, rather than a ticket-shaped shell with an empty
 * array, matches what the database actually does.
 */
const TICKET_ITEMS: ReadEntity<TicketItem> = {
  table: 'ticket_items',
  schema: ticketItemSchema,
  columns: projectionFor(ticketItemSchema, TEXT_CAST_COLUMNS),
  softDeleted: true,
};

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

/** Filters for the customer list. All optional, combined with AND. */
export interface CustomerFilters {
  /**
   * Restrict to walk-in placeholders (`true`) or to named customers (`false`). Omitted
   * means both.
   *
   * Worth stating in a filter rather than leaving to the caller because the two are
   * genuinely different populations: a walk-in row is a counter-sale placeholder that
   * would pollute a customer directory, and a named-customer list that silently included
   * them would show a bakery dozens of "Walk-in" entries.
   */
  isWalkIn?: boolean;
}

/**
 * One page of customers, ordered by name.
 *
 * **Composite `(full_name, id)` cursor**, unlike the catalog lists. Those page on columns
 * that are unique within a tenant (`products.name`, `product_variants.sku`, both backed by
 * unique indexes), so a single-column cursor cannot skip a row. `customers` has no such
 * column: §4 records only an index on `(tenant_id, phone)`, which is not unique, and two
 * customers may legitimately share a name. A `full_name > :last` cursor would drop every
 * namesake after the first — silently, with no error.
 */
export async function listCustomers(
  client: BakeflowClient,
  filters: CustomerFilters = {},
  options: PageOptions = {},
): Promise<Page<Customer>> {
  const context = 'listCustomers';
  const limit = resolveLimit(options.limit);

  let query = withSoftDeleteFilter(
    client.from(CUSTOMERS.table).select(CUSTOMERS.columns),
    CUSTOMERS,
  );

  if (filters.isWalkIn !== undefined) query = query.eq('is_walk_in', filters.isWalkIn);

  if (options.after !== undefined) {
    const { sortValue, id } = decodeCursor(options.after, context);
    const name = quoteFilterValue(sortValue);
    // (full_name, id) > (cursor.full_name, cursor.id) under ASC ordering.
    query = query.or(
      `full_name.gt.${name},and(full_name.eq.${name},id.gt.${quoteFilterValue(id)})`,
    );
  }

  const data = await run(
    query
      .order('full_name', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1),
  );
  const rows = parseRows(CUSTOMERS.schema, data, context);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;

  return {
    rows: page,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.full_name, last.id) : null,
  };
}

/**
 * One customer, or `null` when it does not exist, belongs to another organization, or is
 * soft-deleted. All three are indistinguishable by design — telling them apart would leak
 * the existence of another bakery's customer.
 */
export async function getCustomerById(
  client: BakeflowClient,
  customerId: Uuid,
): Promise<Customer | null> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(CUSTOMERS.table).select(CUSTOMERS.columns).eq('id', customerId),
      CUSTOMERS,
    ).maybeSingle(),
  );
  return parseRow(CUSTOMERS.schema, data, 'getCustomerById');
}

/**
 * Customers matching an exact phone number, ordered by name.
 *
 * Exact match rather than a prefix or `ilike` search, because §4's index on
 * `(tenant_id, phone)` supports equality; a leading-wildcard pattern would not use it and
 * would sequentially scan every customer of the organization.
 *
 * Returns an **array, not a single row.** `phone` carries no unique constraint, and a
 * bakery genuinely has several customers on one household or office number. A signature
 * promising one row would have to pick a winner arbitrarily, and `maybeSingle()` would
 * instead raise on the second — turning ordinary data into an error at the till.
 *
 * Unpaged: the result set is bounded by how many people share one number.
 */
export async function findCustomersByPhone(
  client: BakeflowClient,
  phone: string,
): Promise<Customer[]> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(CUSTOMERS.table).select(CUSTOMERS.columns).eq('phone', phone),
      CUSTOMERS,
    )
      .order('full_name', { ascending: true })
      .order('id', { ascending: true }),
  );
  return parseRows(CUSTOMERS.schema, data, 'findCustomersByPhone');
}

/* -------------------------------------------------------------------------- */
/* Tickets                                                                     */
/* -------------------------------------------------------------------------- */

/** Filters for the ticket list. All optional, combined with AND. */
export interface TicketFilters {
  /**
   * Exactly one status. For "everything still open" pass `openOnly` instead — an
   * `in`-list of the seven non-terminal statuses is a query the caller should not have to
   * assemble, and assembling it by hand is how the `cancelled`-is-not-terminal trap gets
   * sprung.
   */
  status?: TicketStatus;
  /** Restrict to statuses a ticket can still transition out of. */
  openOnly?: boolean;
  branchId?: Uuid;
  customerId?: Uuid;
  assignedTo?: Uuid;
  fulfilmentType?: TicketFulfilmentType;
  /** Inclusive lower bound on `created_at`, as an ISO-8601 timestamp. */
  since?: string;
}

/**
 * The seven statuses a ticket can still leave.
 *
 * `cancelled` is in this list. It is **not** terminal — its one legal exit is `archived`
 * (`STATE-MACHINES.md` §1) — and a cancelled ticket awaiting archival is exactly the kind
 * of row an operations screen must not hide. `completed` and `archived` are the only two
 * excluded.
 */
const OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  'draft',
  'submitted',
  'confirmed',
  'scheduled',
  'in_production',
  'ready',
  'delivered',
  'cancelled',
];

/**
 * One page of tickets, **newest first**.
 *
 * Newest-first because a ticket list answers "what is happening now", and because the tail
 * is the part that changes.
 *
 * Uses the composite `(created_at, id)` cursor for the same reason the stock ledger does:
 * several tickets can share a `created_at` to the microsecond — a sync batch applies its
 * whole payload in one transaction — and a single-column cursor would drop every sibling
 * sharing that instant.
 *
 * `ticket_number` would have been a legal single-column cursor (`UNIQUE (tenant_id,
 * ticket_number)`), but it sorts lexicographically as `text`, so `TCK-100` precedes
 * `TCK-99`. Ordering a "recent orders" screen that way would be wrong in a way that looks
 * plausible for the first nine days of use.
 */
export async function listTickets(
  client: BakeflowClient,
  filters: TicketFilters = {},
  options: PageOptions = {},
): Promise<Page<Ticket>> {
  const context = 'listTickets';
  const limit = resolveLimit(options.limit);

  let query = withSoftDeleteFilter(
    client.from(TICKETS.table).select(TICKETS.columns),
    TICKETS,
  );

  if (filters.status !== undefined) query = query.eq('status', filters.status);
  if (filters.openOnly === true) query = query.in('status', [...OPEN_TICKET_STATUSES]);
  if (filters.branchId !== undefined) query = query.eq('branch_id', filters.branchId);
  if (filters.customerId !== undefined) query = query.eq('customer_id', filters.customerId);
  if (filters.assignedTo !== undefined) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.fulfilmentType !== undefined)
    query = query.eq('fulfilment_type', filters.fulfilmentType);
  if (filters.since !== undefined) query = query.gte('created_at', filters.since);

  if (options.after !== undefined) {
    const { sortValue, id } = decodeCursor(options.after, context);
    const ts = quoteFilterValue(sortValue);
    // (created_at, id) < (cursor.created_at, cursor.id) under DESC ordering.
    query = query.or(
      `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${quoteFilterValue(id)})`,
    );
  }

  const data = await run(
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1),
  );
  const rows = parseRows(TICKETS.schema, data, context);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;

  return {
    rows: page,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
}

/**
 * One ticket, or `null` when it does not exist, belongs to another organization, sits in a
 * branch the caller cannot reach, or is soft-deleted. All four are indistinguishable by
 * design.
 */
export async function getTicketById(
  client: BakeflowClient,
  ticketId: Uuid,
): Promise<Ticket | null> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(TICKETS.table).select(TICKETS.columns).eq('id', ticketId),
      TICKETS,
    ).maybeSingle(),
  );
  return parseRow(TICKETS.schema, data, 'getTicketById');
}

/**
 * One ticket by its human-facing number.
 *
 * `maybeSingle()` is safe here where it was not for `findCustomersByPhone`:
 * `UNIQUE (tenant_id, ticket_number)` holds live, and RLS confines the caller to a single
 * tenant, so at most one row can match.
 *
 * This is the lookup a cashier actually performs — a customer arrives quoting a number off
 * a receipt, not a UUID.
 */
/**
 * The tickets named by a set of ids.
 *
 * Exists to put a human-readable `ticket_number` on rows that carry only a `ticket_id` —
 * the delivery board is the caller. A delivery's own columns say where the goods are going
 * but never which order they belong to, and "TKT-000042" is the only identifier a driver or
 * a manager can match against anything else.
 *
 * Id-driven rather than a page of `listTickets()` because the caller already holds the exact
 * set it needs: paging would fetch tickets nobody asked about and could still miss one whose
 * delivery is on screen. Chunked for the URL-length reason in `IN_CLAUSE_CHUNK`.
 *
 * Soft-deleted tickets are excluded, so a delivery whose ticket was archived resolves to no
 * name rather than to a deleted one. The caller must handle a missing entry — this returns
 * the tickets it can see, not one row per id.
 */
export async function listTicketsByIds(
  client: BakeflowClient,
  ticketIds: readonly Uuid[],
): Promise<Ticket[]> {
  const unique = [...new Set(ticketIds)];
  if (unique.length === 0) return [];

  const batches = await Promise.all(
    chunk(unique, IN_CLAUSE_CHUNK).map(async (ids) =>
      parseRows(
        TICKETS.schema,
        await run(
          withSoftDeleteFilter(
            client.from(TICKETS.table).select(TICKETS.columns).in('id', ids),
            TICKETS,
          ),
        ),
        'listTicketsByIds',
      ),
    ),
  );
  return batches.flat();
}

export async function getTicketByNumber(
  client: BakeflowClient,
  ticketNumber: string,
): Promise<Ticket | null> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(TICKETS.table).select(TICKETS.columns).eq('ticket_number', ticketNumber),
      TICKETS,
    ).maybeSingle(),
  );
  return parseRow(TICKETS.schema, data, 'getTicketByNumber');
}

/**
 * Tickets that correct a given ticket.
 *
 * A financial correction is always a **new ticket** carrying `correction_of_ticket_id`,
 * never an edit of the original (clarification §4, permission `tickets.correct`). So the
 * original stays exactly as it was and its corrections hang off it — which means a screen
 * showing a ticket's true current position has to follow this link rather than trust the
 * ticket alone.
 *
 * Returns an array: nothing constrains a ticket to one correction, and a correction may
 * itself later be corrected.
 */
export async function listTicketCorrections(
  client: BakeflowClient,
  ticketId: Uuid,
): Promise<Ticket[]> {
  const data = await run(
    withSoftDeleteFilter(
      client
        .from(TICKETS.table)
        .select(TICKETS.columns)
        .eq('correction_of_ticket_id', ticketId),
      TICKETS,
    ).order('created_at', { ascending: true }),
  );
  return parseRows(TICKETS.schema, data, 'listTicketCorrections');
}

/* -------------------------------------------------------------------------- */
/* Ticket items                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The lines of one ticket.
 *
 * Unpaged: a ticket's lines are bounded by what one customer ordered.
 *
 * Ordered by `(product_variant_id, id)` rather than by `created_at`. Lines added in one
 * transaction share an instant, so `created_at` alone is not a total order and the same
 * ticket could render its lines in a different sequence on each load — which reads as a
 * bug to a cashier checking an order against a receipt.
 */
export async function listTicketItems(
  client: BakeflowClient,
  ticketId: Uuid,
): Promise<TicketItem[]> {
  const data = await run(
    withSoftDeleteFilter(
      client
        .from(TICKET_ITEMS.table)
        .select(TICKET_ITEMS.columns)
        .eq('ticket_id', ticketId),
      TICKET_ITEMS,
    )
      .order('product_variant_id', { ascending: true })
      .order('id', { ascending: true }),
  );
  return parseRows(TICKET_ITEMS.schema, data, 'listTicketItems');
}

/**
 * A ticket together with its lines.
 *
 * Two sequential round trips rather than one embedded PostgREST select: an embedded
 * resource does not carry the `::text` casts, so every nested money value would arrive as
 * an IEEE-754 double with its scale already gone. Two validated reads keep all eight
 * numeric columns on the exact-decimal path.
 *
 * Returns `null` when the ticket itself is not visible, rather than an empty shell. A
 * caller checking `items.length === 0` on an invisible ticket would otherwise read it as
 * "a ticket with no lines" — which is a real and different state, since `draft` tickets
 * legitimately have none until the first item is added.
 */
export async function getTicketWithItems(
  client: BakeflowClient,
  ticketId: Uuid,
): Promise<TicketWithItems | null> {
  const ticket = await getTicketById(client, ticketId);
  if (ticket === null) return null;
  const items = await listTicketItems(client, ticketId);
  return { ticket, items };
}
