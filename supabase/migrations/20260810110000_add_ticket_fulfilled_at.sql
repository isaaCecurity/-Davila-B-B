-- BakeFlow — add tickets.fulfilled_at, the authoritative revenue-recognition timestamp
--
-- Closes the blocking gap identified in REPORTING-MODEL.md section 78 ("Ticket fulfillment
-- timestamp") and recorded in PROJECT-OVERVIEW.md section 7.
--
-- STATUS: NOT APPLIED to production, consistent with the other migrations in this
-- directory. Apply this BEFORE 20260810120000_reporting_views.sql, which consumes the
-- column.
--
-- ---------------------------------------------------------------------------
-- Why this column is necessary
-- ---------------------------------------------------------------------------
-- REPORTING-MODEL.md section 5 recognizes revenue on the fulfilment/delivery event, and
-- section 8 requires the timestamp of that business event specifically -- not created_at,
-- not payment time, and explicitly NOT server_received_at.
--
-- Before this migration the only candidates were:
--
--   deliveries.delivered_at    authoritative, but exists only when fulfilment_type =
--                              'delivery'. A PICKUP sale has no row at all.
--   audit_log status_change    exists for every ticket, but records when the SERVER
--                              processed the transition. For a sale made offline and
--                              synced hours later that is sync time, which section 8
--                              and section 9 forbid using as the business-event time.
--
-- So an offline pickup sale -- an ordinary event for a driver in the field -- had no
-- correct recognition timestamp at all, and its revenue would have landed on the day the
-- device reconnected. REPORTING-MODEL.md section 10 calls that out as the exact failure
-- the offline-first architecture must avoid.
--
-- ---------------------------------------------------------------------------
-- Design
-- ---------------------------------------------------------------------------
-- fulfilled_at is a BUSINESS-EVENT timestamp, so for offline sales the client supplies it
-- and the server validates it. That is a deliberate trade-off: the client is the only
-- party that knows when the sale actually happened, but a client-supplied timestamp could
-- otherwise be used to move revenue between reporting periods (clarification section 8).
-- The constraints below bound it on both sides, and the value is frozen once set.
--
-- Note the difference from tickets.device_created_at: that is when the driver STARTED the
-- ticket on the device; fulfilled_at is when the sale was actually completed. They are
-- usually close but are not the same event, and revenue depends on the latter.

alter table public.tickets
  add column if not exists fulfilled_at timestamptz;

comment on column public.tickets.fulfilled_at is
  'Business-event timestamp of fulfilment. The authoritative basis for revenue recognition (REPORTING-MODEL.md sections 5, 8). Client-supplied for offline sales, server-validated, immutable once set. NOT sync time -- see server_received_at for that.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Production currently holds zero tickets, so this is a no-op today and exists so the
-- migration stays correct if applied to an environment that does have data.
--
-- Delivery rows first (authoritative), then the audit-log status change (approximate).
-- Anything still null after this has no recoverable fulfilment time and must not be
-- silently invented -- it will simply be absent from revenue.

update public.tickets t
   set fulfilled_at = d.delivered_at
  from public.deliveries d
 where d.ticket_id = t.id
   and d.status = 'delivered'
   and d.deleted_at is null
   and t.fulfilled_at is null
   and t.status in ('delivered', 'completed');

update public.tickets t
   set fulfilled_at = a.occurred_at
  from (
    select al.entity_id, min(al.occurred_at) as occurred_at
    from public.audit_log al
    where al.entity_type = 'ticket'
      and al.action = 'status_change'
      and al.after ->> 'status' = 'delivered'
      and al.deleted_at is null
    group by al.entity_id
  ) a
 where a.entity_id = t.id
   and t.fulfilled_at is null
   and t.status in ('delivered', 'completed');

-- ---------------------------------------------------------------------------
-- Integrity constraints
-- ---------------------------------------------------------------------------

-- A sale cannot be fulfilled before the ticket existed on the device. Guards against a
-- client backdating revenue into a closed reporting period.
alter table public.tickets
  drop constraint if exists tickets_fulfilled_after_creation;
alter table public.tickets
  add constraint tickets_fulfilled_after_creation
  check (
    fulfilled_at is null
    or fulfilled_at >= coalesce(device_created_at, created_at) - interval '1 hour'
  );

-- Nor can it be fulfilled in the future. One hour of slack absorbs ordinary device clock
-- skew without allowing revenue to be pushed into a later period.
alter table public.tickets
  drop constraint if exists tickets_fulfilled_not_future;
alter table public.tickets
  add constraint tickets_fulfilled_not_future
  check (fulfilled_at is null or fulfilled_at <= now() + interval '1 hour');

-- ---------------------------------------------------------------------------
-- Stamping and immutability
-- ---------------------------------------------------------------------------
-- Sets fulfilled_at automatically when a ticket reaches 'delivered' and the caller did not
-- supply one (the online case, where server time IS the business-event time).
--
-- Once set, the value is frozen: it is a financial fact, and
-- BAKEFLOW-PROJECT-LOGIC-CLARIFICATION.md section 4 requires corrections to be new
-- records rather than edits to history. Changing it would silently move revenue between
-- reporting periods.

create or replace function public.stamp_ticket_fulfilled_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.fulfilled_at is not null
     and new.fulfilled_at is distinct from old.fulfilled_at then
    raise exception 'fulfilled_at is immutable once set; create a correction ticket instead'
      using errcode = 'P0001',
            detail  = json_build_object('code', 'fulfilled_at_immutable',
                                        'existing', old.fulfilled_at)::text;
  end if;

  -- Online path: no client-supplied business-event time, so server time is correct.
  if new.status = 'delivered'
     and new.fulfilled_at is null then
    new.fulfilled_at := now();
  end if;

  return new;
end;
$$;

comment on function public.stamp_ticket_fulfilled_at() is
  'Stamps fulfilled_at on transition to delivered when the client supplied none, and freezes it thereafter.';

revoke all on function public.stamp_ticket_fulfilled_at() from public, anon, authenticated;

drop trigger if exists tickets_stamp_fulfilled_at on public.tickets;
create trigger tickets_stamp_fulfilled_at
  before insert or update on public.tickets
  for each row
  execute function public.stamp_ticket_fulfilled_at();

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------
-- Every revenue query is a date range over (tenant, branch, fulfilment time). Partial,
-- because only fulfilled tickets are ever scanned for revenue.

create index if not exists tickets_tenant_branch_fulfilled_idx
  on public.tickets (tenant_id, branch_id, fulfilled_at)
  where fulfilled_at is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Follow-up required in prevent_submitted_ticket_update()
-- ---------------------------------------------------------------------------
-- That trigger enumerates the columns frozen on a submitted ticket. fulfilled_at is NOT
-- in its list, so today it is protected only by stamp_ticket_fulfilled_at() above. When
-- the hybrid-immutability remediation is written (see STATE-MACHINES.md section 1), add
-- fulfilled_at, subtotal_amount and total_amount to the frozen set and remove status,
-- assigned_to and due_at from it.
--
-- That remediation is deliberately NOT bundled here: this migration only adds a column
-- and is safe in isolation, whereas rewriting the immutability trigger is a behavioural
-- change the owner has chosen to review separately.
