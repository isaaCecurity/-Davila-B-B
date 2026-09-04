-- enforce_rate_limit() had a genuine check-then-act race: SELECT count(*) then,
-- conditionally, INSERT, with no lock and no constraint. Under READ COMMITTED, N
-- concurrent callers for the same (tenant_id, scope) can all pass the count-check before
-- any of them commits its own insert, letting a burst through beyond p_limit.
--
-- Fixed with pg_advisory_xact_lock, taken after input validation (no reason to serialize
-- a request that's about to be rejected as malformed) and before the count-check. It
-- auto-releases at transaction end (safe even on the exception path below), and serializes
-- only same-(tenant_id, scope) callers against each other -- not a global lock. The
-- two-argument (int, int) form (hash of scope, hash of tenant) rather than one 64-bit hash
-- of the concatenation means an accidental collision needs both independent 32-bit hashes
-- to collide at once; even then the failure mode is harmless (unrelated tenant/scope pairs
-- briefly serialize, never a correctness gap).
--
-- Alternatives considered and rejected: a counter row + SELECT ... FOR UPDATE (would turn
-- rate_limit_events from an append-only per-call event log, kept for actor_id
-- traceability, into a per-window counter row -- a bigger schema change than the bug
-- warrants); a unique/exclusion constraint (doesn't fit a *sliding* window -- there's no
-- natural key to constrain against without inventing fixed time buckets, a real behavior
-- change); SERIALIZABLE isolation (can't be set from inside this function -- isolation
-- level must be chosen before any statement runs in the caller's transaction -- and would
-- push retry handling onto every future caller of this shared primitive).
--
-- Verified live 2026-09-04: two back-to-back calls with p_limit=1 against a shared
-- (tenant_id, scope) produced exactly one success and one 'rate_limited' rejection, with
-- exactly one row landing in rate_limit_events -- see IMPLEMENTATION_LOG.md.
CREATE OR REPLACE FUNCTION public.enforce_rate_limit(p_tenant_id uuid, p_actor_id uuid, p_scope text, p_limit integer, p_window_minutes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_tenant_id IS NULL OR p_scope IS NULL OR p_limit IS NULL OR p_window_minutes IS NULL THEN
    RAISE EXCEPTION 'enforce_rate_limit requires tenant_id, scope, limit, and window_minutes'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_limit < 1 OR p_window_minutes < 1 THEN
    RAISE EXCEPTION 'enforce_rate_limit: limit and window_minutes must be positive'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  -- Serialize concurrent callers for the same (tenant_id, scope) so the count-check below
  -- can't be raced -- see migration header for why this specific mechanism was chosen.
  PERFORM pg_advisory_xact_lock(hashtext(p_scope || ':rate_limit'), hashtext(p_tenant_id::text));

  -- Counted per (tenant, scope), not per actor: the resource this protects (recipient
  -- inboxes, a transactional-email provider's quota and sender reputation) is a
  -- tenant-level concern, so one compromised or careless member of a tenant cannot dodge
  -- the cap by acting alone -- it caps the tenant's total call volume for this scope, not
  -- any one member's. actor_id is still recorded on each row for traceability.
  SELECT count(*) INTO v_count
  FROM public.rate_limit_events
  WHERE tenant_id = p_tenant_id
    AND scope = p_scope
    AND occurred_at > now() - make_interval(mins => p_window_minutes);

  IF v_count >= p_limit THEN
    RAISE EXCEPTION 'rate limit exceeded for scope %: % of % calls used in the last % minutes',
      p_scope, v_count, p_limit, p_window_minutes
      USING errcode = 'P0001',
            detail = json_build_object(
              'code', 'rate_limited',
              'scope', p_scope,
              'limit', p_limit,
              'window_minutes', p_window_minutes
            )::text;
  END IF;

  INSERT INTO public.rate_limit_events (tenant_id, actor_id, scope)
  VALUES (p_tenant_id, p_actor_id, p_scope);
END;
$function$;
