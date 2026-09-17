-- BACKEND_ROADMAP P9.9 Q5. Owner decision 2026-09-17: in-app notification history + phone push.
--
-- Events (the set offered to and chosen by the owner) and who receives them. "Leads" = owners and
-- admins of the organization plus branch managers of the event's branch (or organization-wide
-- managers). The person who caused an event never receives it.
--   order_new        a ticket reaches `submitted`                       → leads
--   order_ready      a ticket reaches `ready`                           → its creator, its assignee, leads
--   payment_received a payment is recorded by someone other than the    → the ticket's creator, leads
--                    ticket's creator (a sale taken and paid by the same person is not news — this keeps
--                    every counter and roadside sale from notifying)
--   stock_out        a product stock level goes from above zero to ≤ 0  → leads
--   invite_accepted  an invite becomes `accepted`                        → whoever sent it
--   till_variance    a cash session closes with a non-zero variance      → leads
--
-- Push: every notification is queued (`push_status = 'pending'`). The `dispatch-push` Edge Function
-- (called by the app after actions that can create notifications) claims pending rows with the service
-- role, sends them through Expo's push service to the recipient's registered devices for that
-- organization, and records the outcome. Nothing here needs a database extension.
--
-- Tables are organization-scoped (tenant_id), RLS enabled and forced; clients read their own
-- notifications and tokens only, and write only through the RPCs below.

-- ── tables ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.organizations(id),
  branch_id     uuid NULL,
  recipient_id  uuid NOT NULL REFERENCES public.profiles(id),
  kind          text NOT NULL CHECK (kind IN ('order_new','order_ready','payment_received','stock_out','invite_accepted','till_variance')),
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  body          text NULL CHECK (body IS NULL OR char_length(body) <= 500),
  entity_type   text NULL CHECK (entity_type IS NULL OR char_length(entity_type) <= 60),
  entity_id     uuid NULL,
  route         text NULL CHECK (route IS NULL OR route ~ '^/[A-Za-z0-9/_-]{0,199}$'),
  actor_id      uuid NULL REFERENCES public.profiles(id),
  read_at       timestamptz NULL,
  push_status   text NOT NULL DEFAULT 'pending' CHECK (push_status IN ('pending','sending','sent','skipped','failed')),
  push_attempts integer NOT NULL DEFAULT 0 CHECK (push_attempts >= 0),
  pushed_at     timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz NULL,
  deleted_by    uuid NULL REFERENCES public.profiles(id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id)
);

CREATE INDEX idx_notifications_recipient ON public.notifications (recipient_id, tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_notifications_unread ON public.notifications (recipient_id, tenant_id) WHERE read_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_notifications_push_pending ON public.notifications (created_at) WHERE push_status IN ('pending','sending');
CREATE INDEX idx_notifications_tenant_branch ON public.notifications (tenant_id, branch_id);
CREATE INDEX idx_notifications_actor ON public.notifications (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_notifications_deleted_by ON public.notifications (deleted_by) WHERE deleted_by IS NOT NULL;

CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_select_own ON public.notifications
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (recipient_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()) AND deleted_at IS NULL);

REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE TABLE public.push_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.organizations(id),
  profile_id         uuid NOT NULL REFERENCES public.profiles(id),
  token              text NOT NULL CHECK (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  platform           text NOT NULL CHECK (platform IN ('ios','android')),
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, profile_id, token)
);

CREATE INDEX idx_push_tokens_profile ON public.push_tokens (profile_id, tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_push_tokens_token ON public.push_tokens (token);

CREATE TRIGGER push_tokens_set_updated_at BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY push_tokens_select_own ON public.push_tokens
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()));

REVOKE ALL ON public.push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

-- ── recipients and insertion ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.notification_leads(p_tenant_id uuid, p_branch_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT DISTINCT ur.profile_id
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
    JOIN public.profiles p ON p.id = ur.profile_id AND p.deleted_at IS NULL AND p.status = 'active'
   WHERE ur.tenant_id = p_tenant_id
     AND ur.deleted_at IS NULL
     AND (r.key IN ('owner','admin')
          OR (r.key = 'branch_manager' AND (ur.branch_id IS NULL OR ur.branch_id = p_branch_id)));
$function$;

CREATE OR REPLACE FUNCTION private.notify(
  p_tenant_id   uuid,
  p_branch_id   uuid,
  p_kind        text,
  p_title       text,
  p_body        text,
  p_entity_type text,
  p_entity_id   uuid,
  p_route       text,
  p_recipients  uuid[]
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
BEGIN
  INSERT INTO public.notifications
    (tenant_id, branch_id, recipient_id, kind, title, body, entity_type, entity_id, route, actor_id)
  SELECT p_tenant_id, p_branch_id, rcpt, p_kind, left(p_title, 160), left(p_body, 500), p_entity_type, p_entity_id, p_route, v_actor
    FROM (SELECT DISTINCT unnest(p_recipients) AS rcpt) x
   WHERE rcpt IS NOT NULL
     AND rcpt IS DISTINCT FROM v_actor
     -- only people who still belong to the organization
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.profile_id = rcpt AND ur.tenant_id = p_tenant_id AND ur.deleted_at IS NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION private.notification_leads(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify(uuid, uuid, text, text, text, text, uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;

-- ── event triggers ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_ticket_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_customer text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'submitted') THEN
    SELECT c.full_name INTO v_customer FROM public.customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id;
    PERFORM private.notify(NEW.tenant_id, NEW.branch_id, 'order_new',
      'New order ' || NEW.ticket_number,
      coalesce(v_customer, 'Walk-in customer') || ' · ₦' || to_char(NEW.total_amount, 'FM999,999,999,990.00'),
      'ticket', NEW.id, '/order/' || NEW.id::text,
      ARRAY(SELECT private.notification_leads(NEW.tenant_id, NEW.branch_id)));
  ELSIF NEW.status = 'ready' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'ready' THEN
    SELECT c.full_name INTO v_customer FROM public.customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id;
    PERFORM private.notify(NEW.tenant_id, NEW.branch_id, 'order_ready',
      'Order ' || NEW.ticket_number || ' is ready',
      coalesce(v_customer, 'Walk-in customer') || ' · ' || CASE WHEN NEW.fulfilment_type = 'delivery' THEN 'ready for delivery' ELSE 'ready for pickup' END,
      'ticket', NEW.id, '/order/' || NEW.id::text,
      ARRAY[NEW.created_by, NEW.assigned_to] || ARRAY(SELECT private.notification_leads(NEW.tenant_id, NEW.branch_id)));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER tickets_notify_status AFTER INSERT OR UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_status();

CREATE OR REPLACE FUNCTION public.notify_payment_received()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ticket public.tickets;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets t WHERE t.id = NEW.ticket_id AND t.tenant_id = NEW.tenant_id;
  IF v_ticket.id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- A sale taken and paid by the same person is not news.
  IF NEW.created_by IS NOT DISTINCT FROM v_ticket.created_by THEN
    RETURN NEW;
  END IF;
  PERFORM private.notify(NEW.tenant_id, NEW.branch_id, 'payment_received',
    '₦' || to_char(NEW.amount, 'FM999,999,999,990.00') || ' received',
    'Order ' || v_ticket.ticket_number || ' · ' ||
      CASE NEW.method WHEN 'pos' THEN 'POS' WHEN 'transfer' THEN 'Transfer' WHEN 'cash' THEN 'Cash' WHEN 'card' THEN 'Card' ELSE 'Credit' END,
    'ticket', v_ticket.id, '/order/' || v_ticket.id::text,
    ARRAY[v_ticket.created_by] || ARRAY(SELECT private.notification_leads(NEW.tenant_id, NEW.branch_id)));
  RETURN NEW;
END;
$function$;

CREATE TRIGGER payments_notify_received AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_received();

CREATE OR REPLACE FUNCTION public.notify_stock_out()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_name text;
  v_product uuid;
BEGIN
  IF NEW.quantity_on_hand <= 0 AND OLD.quantity_on_hand > 0 AND NEW.deleted_at IS NULL THEN
    SELECT p.name || CASE WHEN coalesce(v.name, '') = '' THEN '' ELSE ' · ' || v.name END, p.id
      INTO v_name, v_product
      FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
     WHERE v.id = NEW.product_variant_id;
    PERFORM private.notify(NEW.tenant_id, NEW.branch_id, 'stock_out',
      coalesce(v_name, 'A product') || ' is out of stock',
      CASE WHEN NEW.quantity_on_hand < 0 THEN 'Stock is below zero — check the count' ELSE 'None left in the stockroom' END,
      'product', v_product, CASE WHEN v_product IS NULL THEN '/inventory' ELSE '/product/' || v_product::text END,
      ARRAY(SELECT private.notification_leads(NEW.tenant_id, NEW.branch_id)));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER product_stock_levels_notify_out AFTER UPDATE OF quantity_on_hand ON public.product_stock_levels
  FOR EACH ROW EXECUTE FUNCTION public.notify_stock_out();

CREATE OR REPLACE FUNCTION public.notify_invite_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_name text;
  v_role text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT nullif(p.full_name, '') INTO v_name FROM public.profiles p WHERE p.id = NEW.accepted_by;
    SELECT r.name INTO v_role FROM public.roles r WHERE r.id = NEW.role_id;
    PERFORM private.notify(NEW.tenant_id, NEW.branch_id, 'invite_accepted',
      coalesce(v_name, NEW.email, NEW.phone, 'Someone') || ' joined as ' || coalesce(v_role, 'staff'),
      'Your invite was accepted',
      'organization_invite', NEW.id, '/staff',
      ARRAY[NEW.created_by]);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER organization_invites_notify_accepted AFTER UPDATE OF status ON public.organization_invites
  FOR EACH ROW EXECUTE FUNCTION public.notify_invite_accepted();

CREATE OR REPLACE FUNCTION public.notify_till_variance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed'
     AND NEW.variance_amount IS NOT NULL AND NEW.variance_amount <> 0 THEN
    PERFORM private.notify(NEW.tenant_id, NEW.branch_id, 'till_variance',
      'Till closed ' || CASE WHEN NEW.variance_amount < 0 THEN 'short' ELSE 'over' END
        || ' by ₦' || to_char(abs(NEW.variance_amount), 'FM999,999,999,990.00'),
      'The counted cash did not match the expected amount',
      'cash_session', NEW.id, '/cash',
      ARRAY(SELECT private.notification_leads(NEW.tenant_id, NEW.branch_id)));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER cash_sessions_notify_variance AFTER UPDATE OF status ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_till_variance();

REVOKE ALL ON FUNCTION public.notify_ticket_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_payment_received() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_stock_out() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_invite_accepted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_till_variance() FROM PUBLIC, anon, authenticated;

-- ── client RPCs ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'authentication and an active organization are required'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  UPDATE public.notifications n
     SET read_at = now()
   WHERE n.recipient_id = auth.uid()
     AND n.tenant_id = public.current_tenant_id()
     AND n.read_at IS NULL
     AND n.deleted_at IS NULL
     AND (p_ids IS NULL OR n.id = ANY (p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_row    public.push_tokens;
BEGIN
  IF v_user IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'authentication and an active organization are required'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$' THEN
    RAISE EXCEPTION 'not an Expo push token'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_push_token')::text;
  END IF;
  IF p_platform NOT IN ('ios','android') THEN
    RAISE EXCEPTION 'platform must be ios or android'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_platform')::text;
  END IF;

  -- A device belongs to whoever signed in on it last: stop sending to anyone else on this token.
  UPDATE public.push_tokens SET revoked_at = now()
   WHERE token = p_token AND profile_id <> v_user AND revoked_at IS NULL;

  INSERT INTO public.push_tokens (tenant_id, profile_id, token, platform)
  VALUES (v_tenant, v_user, p_token, p_platform)
  ON CONFLICT (tenant_id, profile_id, token)
  DO UPDATE SET revoked_at = NULL, platform = EXCLUDED.platform, last_registered_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'platform', v_row.platform, 'registered_at', v_row.last_registered_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.push_tokens SET revoked_at = now()
   WHERE token = p_token AND profile_id = auth.uid() AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_push_token(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unregister_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated, service_role;

-- ── push dispatch (service role only; used by the dispatch-push Edge Function) ───────────────────
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_batch jsonb;
BEGIN
  -- Rows stuck in `sending` for 10 minutes (a crashed dispatch) are retried, up to 3 attempts.
  WITH candidates AS (
    SELECT n.id
      FROM public.notifications n
     WHERE n.deleted_at IS NULL
       AND n.push_attempts < 3
       AND (n.push_status = 'pending' OR (n.push_status = 'sending' AND n.updated_at < now() - interval '10 minutes'))
     ORDER BY n.created_at
     LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.notifications n
       SET push_status = CASE WHEN EXISTS (
                               SELECT 1 FROM public.push_tokens t
                                WHERE t.profile_id = n.recipient_id AND t.tenant_id = n.tenant_id AND t.revoked_at IS NULL)
                             THEN 'sending' ELSE 'skipped' END,
           push_attempts = n.push_attempts + 1
      FROM candidates c
     WHERE n.id = c.id
    RETURNING n.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'notification_id', c.id,
           'title', c.title,
           'body', c.body,
           'route', c.route,
           'kind', c.kind,
           'tokens', (SELECT jsonb_agg(t.token) FROM public.push_tokens t
                       WHERE t.profile_id = c.recipient_id AND t.tenant_id = c.tenant_id AND t.revoked_at IS NULL),
           'badge', (SELECT count(*) FROM public.notifications u
                      WHERE u.recipient_id = c.recipient_id AND u.tenant_id = c.tenant_id AND u.read_at IS NULL AND u.deleted_at IS NULL)
         )) FILTER (WHERE c.push_status = 'sending'), '[]'::jsonb)
    INTO v_batch
    FROM claimed c;
  RETURN v_batch;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_push_batch(p_results jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- p_results: [{ notification_id, ok: bool, dead_tokens: [token…] }]
  UPDATE public.notifications n
     SET push_status = CASE WHEN (r->>'ok')::boolean THEN 'sent' ELSE 'failed' END,
         pushed_at = CASE WHEN (r->>'ok')::boolean THEN now() ELSE n.pushed_at END
    FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   WHERE n.id = (r->>'notification_id')::uuid AND n.push_status = 'sending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.push_tokens t
     SET revoked_at = now()
   WHERE t.revoked_at IS NULL
     AND t.token IN (SELECT jsonb_array_elements_text(r->'dead_tokens')
                       FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
                      WHERE jsonb_typeof(r->'dead_tokens') = 'array');
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_push_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_push_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_push_batch(jsonb) TO service_role;
