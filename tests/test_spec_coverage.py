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
