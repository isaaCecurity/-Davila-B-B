import os
import re
import pytest

EB_DIR = "docs/engineering-bible/"

def get_file_content(filename):
    path = os.path.join(EB_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def test_eb006_uses_organization_instead_of_bakery_as_tenant_root():
    content = get_file_content("EB-006-Domain-Model-Ubiquitous-Language.md")

    # We should not have "### Bakery" as a primary entity section header.
    # It should have been renamed to "### Organization" or similar.
    assert "### Bakery" not in content, "EB-006 still has '### Bakery' instead of '### Organization'"
    assert "The Bakery represents the tenant boundary" not in content, "EB-006 still refers to 'The Bakery' as the tenant boundary"

def test_eb020_uses_organization_instead_of_company_for_data_scoping():
    content = get_file_content("EB-020-Enterprise-Data-Architecture-Database-Design-and-Data-Governance-Specification.md")

    # These are key lines where Company was previously used as the tenant root in EB-020.
    # They must be updated to say Organization.
    assert "Every Customer SHALL belong to exactly one Company." not in content, "EB-020 still scopes Customer to Company instead of Organization"
    assert "Every Product SHALL belong to exactly one Company." not in content, "EB-020 still scopes Product to Company instead of Organization"
    assert "Every Supplier SHALL belong to one Company." not in content, "EB-020 still scopes Supplier to Company instead of Organization"
    assert "Every Order belongs to one Company." not in content, "EB-020 still scopes Order to Company instead of Organization"

def _all_eb_files():
    return [f for f in sorted(os.listdir(EB_DIR)) if f.endswith(".md")]


def test_no_superseded_tenant_column_names():
    """tenant_id is the canonical tenant-scoping column. Nothing else."""
    banned = ["organization_id", "bakery_id", "company_id"]
    offenders = {}
    for filename in _all_eb_files():
        content = get_file_content(filename)
        hits = [term for term in banned if term in content]
        if hits:
            offenders[filename] = hits
    assert not offenders, (
        "Superseded tenant column names found — the canonical column is "
        f"'tenant_id' (see CLAUDE.md and PROJECT-OVERVIEW.md section 3): {offenders}"
    )


def test_monetary_type_is_numeric_19_4():
    """NUMERIC(19,4) is the canonical money type. NUMERIC(18,2) was superseded."""
    offenders = {
        filename: get_file_content(filename).count("NUMERIC(18,2)")
        for filename in _all_eb_files()
        if "NUMERIC(18,2)" in get_file_content(filename)
    }
    assert not offenders, (
        "NUMERIC(18,2) found in monetary context — the canonical monetary type is "
        f"NUMERIC(19,4). NUMERIC(18,4) remains correct for quantities: {offenders}"
    )


def test_no_floating_point_money_types():
    """Money is never a float (Core Business Logic Principle 2)."""
    banned = re.compile(r"\b(FLOAT|REAL|DOUBLE PRECISION)\b")
    # A float type is acceptable only when the surrounding prose prohibits it.
    # Prohibitions often sit a few lines above the type inside a fenced block,
    # so check a window rather than the matching line alone.
    prohibition = re.compile(
        r"never|not\b|non-|prohibit|forbid|avoid|shall not|instead of|without|caused by",
        re.IGNORECASE,
    )
    offenders = {}
    for filename in _all_eb_files():
        lines = get_file_content(filename).splitlines()
        for i, line in enumerate(lines):
            if not banned.search(line):
                continue
            window = " ".join(lines[max(0, i - 6):i + 3])
            if not prohibition.search(window):
                offenders.setdefault(filename, []).append(line.strip()[:90])
    assert not offenders, f"Floating-point type used outside a prohibition: {offenders}"


def test_uuid_generation_uses_gen_random_uuid():
    """gen_random_uuid() is canonical; uuid_generate_v4() requires the uuid-ossp extension."""
    offenders = [f for f in _all_eb_files() if "uuid_generate_v4()" in get_file_content(f)]
    assert not offenders, (
        f"uuid_generate_v4() found — use gen_random_uuid() instead: {offenders}"
    )


def test_jwt_tenant_claim_is_tenant_id():
    """RLS policies read the tenant from a claim named tenant_id."""
    claim_pattern = re.compile(r"auth\.jwt\(\)\s*->>\s*'([a-z_]+)'")
    offenders = {}
    for filename in _all_eb_files():
        for claim in set(claim_pattern.findall(get_file_content(filename))):
            if claim in ("organization_id", "bakery_id", "company_id"):
                offenders.setdefault(filename, []).append(claim)
    assert not offenders, f"Non-canonical JWT tenant claim: {offenders}"


def test_canonical_docs_exist():
    """The documents Claude Code depends on must be present."""
    required = [
        "CLAUDE.md",
        "docs/PROJECT-OVERVIEW.md",
        "docs/AI-BUILD-GUIDE.md",
        "docs/DESIGN-TOKENS.md",
        "docs/SCHEMA-REFERENCE.md",
        "docs/RLS-POLICY-PATTERNS.md",
        "docs/API-CONTRACT.md",
        "docs/STATE-MACHINES.md",
        "docs/TESTING-STRATEGY.md",
    ]
    missing = [p for p in required if not os.path.exists(p)]
    assert not missing, f"Missing canonical documents: {missing}"


def test_requirement_id_uniqueness():
    # Parse all EB documents and collect requirement IDs like "EB-XXX-YYY-NNN"
    req_id_pattern = re.compile(r'\b(EB-\d{3}-[A-Z]{2,4}-\d{3})\b')
    all_req_ids = {}

    for filename in os.listdir(EB_DIR):
        if filename.endswith(".md"):
            content = get_file_content(filename)
            req_ids = req_id_pattern.findall(content)
            for req_id in req_ids:
                if req_id in all_req_ids:
                    all_req_ids[req_id].add(filename)
                else:
                    all_req_ids[req_id] = {filename}

    duplicates = {req_id: list(files) for req_id, files in all_req_ids.items() if len(files) > 1}
    assert not duplicates, f"Duplicate requirement IDs found in different files: {duplicates}"
