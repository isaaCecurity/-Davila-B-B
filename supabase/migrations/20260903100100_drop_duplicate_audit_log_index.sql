-- Future-cost audit, 2026-09-02/03: confirmed via live pg_indexes that idx_audit_log_entity
-- and idx_audit_log_tenant_entity_time are byte-for-byte identical
-- (tenant_id, entity_type, entity_id, occurred_at DESC) -- pure write/storage cost with
-- zero read benefit, since Postgres never needs both. Keeping the more descriptively named
-- one that matches this table's sibling idx_audit_log_tenant_time naming convention.
DROP INDEX public.idx_audit_log_entity;
