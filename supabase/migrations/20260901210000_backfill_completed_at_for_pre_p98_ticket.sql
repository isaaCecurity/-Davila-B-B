-- Live database audit (2026-09-01) found one real, historical sale left inconsistent by
-- schema evolution: ticket 2e37d57d-ec56-431e-9805-06b9f8368b89 was completed
-- 2026-08-21 (real stock movement, real ticket_items, subtotal_amount=1000.0000),
-- before tickets.completed_at existed (added by P9.8, 2026-08-28), and before
-- complete_ticket()'s reference_type fix (2026-08-22) -- its stock_movements row still
-- carries the pre-fix reference_type='order'. No CHECK constraint requires completed_at
-- when status='completed', so this was not caught until this audit's live sweep.
--
-- Consequence before this fix: get_daily_revenue_summary() buckets by completed_at, so
-- this real sale was silently excluded from every day's revenue report.
--
-- Fix, per explicit user decision (not guessed): backfill completed_at = created_at,
-- matching what complete_ticket() would have stamped at the time. No invoice is added
-- -- that's a separate, riskier data decision the user did not ask for. The
-- reference_type='order' value on the linked stock_movements row is left as-is: it's a
-- historical record of what the code actually wrote at the time, not itself wrong for
-- the row it's on.
UPDATE public.tickets
SET completed_at = created_at
WHERE id = '2e37d57d-ec56-431e-9805-06b9f8368b89'
  AND status = 'completed'
  AND completed_at IS NULL;
