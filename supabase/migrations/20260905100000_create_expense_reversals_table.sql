-- BLOCKER-028 resolution: expenses now have a real reversal mechanism, mirroring
-- payments/refunds exactly. Same shape as refunds (expense_id, amount, reason,
-- reversed_at, soft-delete pair). RLS SELECT + INSERT policies; the INSERT policy exists
-- for structural parity with refunds_insert but authenticated is never granted INSERT --
-- see the follow-up migration in this batch that revokes it to match refunds' own live
-- grant pattern exactly. All writes go through record_expense_reversal()/
-- apply_expense_reverse() (SECURITY DEFINER).

CREATE TABLE public.expense_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reversed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT expense_reversals_branch_fkey FOREIGN KEY (tenant_id, branch_id)
    REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.expense_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_reversals FORCE ROW LEVEL SECURITY;

CREATE POLICY expense_reversals_select ON public.expense_reversals
  FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND public.has_branch_access(branch_id) AND deleted_at IS NULL);

CREATE POLICY expense_reversals_insert ON public.expense_reversals
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_branch_access(branch_id)
    AND public.has_role(ARRAY['owner','admin','branch_manager'])
  );

GRANT SELECT, INSERT ON public.expense_reversals TO authenticated;
GRANT ALL ON public.expense_reversals TO service_role;
