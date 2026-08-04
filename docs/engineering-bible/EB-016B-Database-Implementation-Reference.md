========================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
1/42

Action:
NEW DOCUMENT

Filename:
EB-016-Database-Implementation-Reference.md

Status:
BEGIN DOCUMENT

========================================

# Database Implementation Reference

## Purpose

This document serves as the complete implementation companion to **EB-011 – Database Architecture**.

Where EB-011 explains **why** BakeFlow's database is designed the way it is, this document specifies **exactly how** it is implemented.

It contains the complete implementation reference for every PostgreSQL database object required by BakeFlow, including:

- Tables
- Columns
- Data Types
- Primary Keys
- Foreign Keys
- Constraints
- Indexes
- Row-Level Security Policies
- Views
- Materialized Views
- Triggers
- Stored Procedures
- SQL Functions
- Migration Order
- Seed Data
- PostgreSQL Extensions

This document intentionally avoids architectural philosophy.

Its purpose is implementation.

---

# Relationship to EB-011

This document SHALL be read together with:

**EB-011 — Database Architecture**

Relationship:

| EB-011 | EB-016 |
|---------|---------|
| Explains why | Explains how |
| Architecture | Implementation |
| Design Decisions | SQL Objects |
| Data Flow | Physical Schema |
| Business Rules | Database Enforcement |
| Principles | PostgreSQL Objects |

EB-011 remains the authoritative architectural reference.

EB-016 remains the authoritative implementation reference.

---

# Implementation Philosophy

Every implementation SHALL satisfy the architectural requirements established in EB-011.

Whenever uncertainty exists:

Architecture SHALL take precedence.

Implementation SHALL never contradict architecture.

---

# Target Platform

Canonical implementation target:

```text
PostgreSQL 17+
```

Hosted using:

```text
Supabase
```

Required extensions SHALL remain compatible with managed Supabase deployments.

---

# Database Characteristics

BakeFlow SHALL implement:

- Relational Database
- ACID Transactions
- UUID Primary Keys
- Row-Level Security
- JSONB Support
- Full-Text Search
- Generated Columns
- Materialized Views
- Declarative Partitioning (where required)

No unsupported PostgreSQL features SHALL become mandatory.

---

# PostgreSQL Extensions

The following extensions SHALL be enabled.

| Extension | Purpose |
|------------|----------|
| pgcrypto | UUID generation |
| uuid-ossp *(optional)* | Legacy UUID compatibility |
| pg_trgm | Fast text search |
| unaccent | Search normalization |
| btree_gin | Advanced indexing |
| pg_stat_statements | Query performance monitoring |

Additional extensions SHALL require architecture approval.

---

# Database Encoding

Implementation SHALL use:

```text
UTF-8
```

Locale:

```text
en_US.UTF-8
```

Unicode support SHALL remain mandatory.

---

# Time Standard

All timestamps SHALL use:

```sql
TIMESTAMPTZ
```

Internal storage SHALL always be:

```text
UTC
```

Applications SHALL perform timezone conversion.

---

# Identifier Strategy

Every major business entity SHALL use:

```sql
UUID
```

Generated using:

```sql
gen_random_uuid()
```

Example:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

Sequential integers SHALL never be used as authoritative identifiers.

---

# Naming Standards

All database objects SHALL use:

```text
snake_case
```

Examples:

```text
customer

customer_address

inventory_item

journal_entry
```

CamelCase SHALL remain prohibited.

---

# Table Naming

Business entities SHALL use singular nouns.

Examples:

```text
customer

employee

invoice

payment

warehouse

recipe
```

Plural table names SHALL not be used.

---

# Column Naming

Columns SHALL remain descriptive.

Examples:

```text
customer_name

phone_number

created_at

tenant_id

unit_cost
```

Abbreviations SHALL be avoided unless universally understood.

---

# Primary Keys

Every table SHALL contain:

```sql
id UUID PRIMARY KEY
DEFAULT gen_random_uuid()
```

No alternative primary key convention SHALL be used unless explicitly documented.

---

# Foreign Keys

Foreign keys SHALL follow:

```text
<entity>_id
```

Examples:

```text
customer_id

branch_id

tenant_id

invoice_id

payment_id
```

Relationship naming SHALL remain consistent across the platform.

---

# Required Audit Columns

Every business table SHALL include:

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Where applicable, tables SHALL additionally include:

```sql
created_by UUID

updated_by UUID
```

Audit metadata SHALL remain standardized.

---

# Soft Delete Standard

Soft-deletable entities SHALL implement:

```sql
is_deleted BOOLEAN NOT NULL DEFAULT FALSE

deleted_at TIMESTAMPTZ

deleted_by UUID
```

Business records SHALL remain recoverable.

---

# Monetary Data Types

Financial values SHALL use:

```sql
NUMERIC(19,4)
```

Higher precision MAY be used for calculations where required.

Floating-point types SHALL never store monetary values.

---

# Quantity Data Types

Inventory quantities SHALL use:

```sql
NUMERIC(18,4)
```

Higher precision MAY be introduced for specialized inventory units.

---

# Text Data Types

Recommended usage:

| Type | Usage |
|--------|------|
| TEXT | Long descriptions |
| VARCHAR | Fixed maximum length business fields |
| CHAR | Rare fixed-length values |

Artificial length restrictions SHALL be avoided unless required.

---

# Boolean Defaults

Recommended defaults:

```sql
is_active BOOLEAN DEFAULT TRUE

is_deleted BOOLEAN DEFAULT FALSE
```

Boolean intent SHALL remain immediately understandable.

---

# Constraint Strategy

Implementation SHALL utilize database constraints whenever possible.

Constraint categories include:

- Primary Keys
- Foreign Keys
- Unique Constraints
- Check Constraints
- NOT NULL Constraints
- Default Constraints

Application validation SHALL complement—not replace—database enforcement.

---

# Index Strategy

Indexes SHALL support:

- Foreign Keys
- Frequent Search Columns
- Business Identifiers
- Reporting
- Sorting
- Synchronization

Unused indexes SHALL be avoided.

---

# Row-Level Security

Every tenant-owned table SHALL enable:

```sql
ALTER TABLE table_name
ENABLE ROW LEVEL SECURITY;
```

Policies SHALL be documented within their respective implementation sections.

---

# Object Ordering

Database objects SHALL be introduced in the following order throughout this document:

1. Extensions
2. ENUM Types
3. Core Tables
4. Lookup Tables
5. Junction Tables
6. Constraints
7. Indexes
8. Views
9. Materialized Views
10. Triggers
11. Functions
12. Procedures
13. RLS Policies
14. Seed Data

Dependency ordering SHALL remain deterministic.

---

# Document Organization

The remainder of this document is organized as follows:

**Part I**

Implementation Standards *(Current Section)*

**Part II**

Core Database Schema

**Part III**

Product & Production Schema

**Part IV**

Inventory Schema

**Part V**

Sales Schema

**Part VI**

Finance Schema

**Part VII**

Security & Row-Level Security

**Part VIII**

Views, Triggers & Functions

**Part IX**

Migration & Seed Data

**Part X**

Master Object Registry

Each section SHALL contain complete implementation specifications.

---

END OF CHUNK 1/42

Next:

Chunk 2/42 — PostgreSQL Foundation Implementation: Schemas, Extensions, ENUM Types, Domains, Global Conventions & Base Database Configuration

Append this chunk immediately below Chunk 1/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
2/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 1/42

Status:
Continuation

========================================

# Part I — PostgreSQL Foundation Implementation

## Purpose

This section defines the foundational PostgreSQL implementation required before any BakeFlow business tables are created.

It establishes:

- Database Schemas
- Required Extensions
- ENUM Types
- Domains
- Global Configuration
- Naming Conventions
- Timestamp Standards
- UUID Standards
- Base Functions

Everything in this section SHALL exist before the first application migration.

---

# Supported PostgreSQL Version

Minimum supported version:

```text
PostgreSQL 17
```

Recommended deployment:

```text
Supabase Managed PostgreSQL
```

Future PostgreSQL upgrades SHALL maintain backward compatibility whenever practical.

---

# Required Database Schemas

BakeFlow SHALL create the following schemas.

| Schema | Purpose |
|---------|----------|
| public | Core application tables |
| auth | Supabase Authentication |
| storage | Supabase Storage |
| realtime | Supabase Realtime |
| audit | Audit records |
| reporting | Reporting Views |
| analytics | Materialized Views |
| integration | External integrations |
| ai | Future AI features |

The `public` schema SHALL remain the default application schema.

---

# Schema Ownership

| Schema | Owner |
|---------|------|
| public | postgres |
| audit | postgres |
| reporting | postgres |
| analytics | postgres |
| integration | postgres |
| ai | postgres |

Application roles SHALL receive only required permissions.

---

# Required Extensions

BakeFlow SHALL install the following extensions.

## pgcrypto

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Purpose:

- UUID generation
- Cryptographic functions

---

## pg_trgm

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Purpose:

- Fast similarity searches
- Product search
- Customer search

---

## unaccent

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Purpose:

- Accent-insensitive searching

Example:

```text
José

=

Jose
```

---

## btree_gin

```sql
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

Purpose:

Hybrid indexing.

---

## pg_stat_statements

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Purpose:

Production query monitoring.

---

# Optional Extensions

Future versions MAY additionally enable:

```text
postgis

pgvector

hstore
```

These SHALL remain optional.

---

# Database Encoding

```text
UTF-8
```

Implementation:

```sql
ENCODING 'UTF8'
```

Unicode SHALL remain mandatory.

---

# Database Collation

Recommended:

```text
en_US.UTF-8
```

Sorting SHALL remain deterministic.

---

# Search Configuration

Default configuration:

```sql
english
```

Future localization MAY introduce additional search configurations.

---

# Time Configuration

Database timezone:

```sql
UTC
```

Implementation:

```sql
SET timezone='UTC';
```

Applications SHALL perform localization.

---

# UUID Standard

Every primary key SHALL use:

```sql
UUID
```

Generated with:

```sql
gen_random_uuid()
```

Example:

```sql
id UUID
DEFAULT gen_random_uuid()
PRIMARY KEY
```

---

# Default Timestamp Standard

Every business table SHALL contain:

```sql
created_at TIMESTAMPTZ
NOT NULL
DEFAULT NOW()
```

and

```sql
updated_at TIMESTAMPTZ
NOT NULL
DEFAULT NOW()
```

---

# Default Boolean Convention

Recommended defaults:

```sql
is_active BOOLEAN DEFAULT TRUE;

is_deleted BOOLEAN DEFAULT FALSE;
```

Business-specific flags SHALL define explicit defaults.

---

# Numeric Precision Standards

## Currency

```sql
NUMERIC(19,4)
```

Examples:

```text
1250.50

19.99

500000.00
```

---

## Inventory Quantity

```sql
NUMERIC(18,4)
```

Examples:

```text
10.2500

0.1250

150.0000
```

---

## Percentage

```sql
NUMERIC(5,2)
```

Example:

```text
15.50
```

---

# Standard Text Types

| Purpose | Type |
|----------|------|
| Descriptions | TEXT |
| Names | VARCHAR |
| Codes | VARCHAR |
| Email | VARCHAR |
| Phone | VARCHAR |
| URLs | TEXT |

Artificial limits SHALL only exist when business rules require them.

---

# Standard Domains

BakeFlow SHALL define reusable PostgreSQL domains where appropriate.

---

## email_address

```sql
CREATE DOMAIN email_address AS TEXT
CHECK (
VALUE ~*
'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
);
```

---

## phone_number

```sql
CREATE DOMAIN phone_number AS TEXT;
```

Validation SHALL primarily occur within application services.

---

## money_amount

```sql
CREATE DOMAIN money_amount
AS NUMERIC(19,4)
CHECK (VALUE >= 0);
```

---

## inventory_quantity

```sql
CREATE DOMAIN inventory_quantity
AS NUMERIC(18,4);
```

---

# Standard ENUM Types

BakeFlow SHALL define reusable ENUM types.

---

## organization_status_enum

```sql
CREATE TYPE organization_status_enum AS ENUM (

'active',

'inactive',

'suspended'
);
```

---

## employee_status_enum

```sql
CREATE TYPE employee_status_enum AS ENUM (

'active',

'inactive',

'on_leave',

'terminated'
);
```

---

## payment_status_enum

```sql
CREATE TYPE payment_status_enum AS ENUM (

'pending',

'partial',

'paid',

'refunded',

'cancelled'
);
```

---

## order_status_enum

```sql
CREATE TYPE order_status_enum AS ENUM (

'draft',

'confirmed',

'processing',

'ready',

'delivered',

'cancelled'
);
```

---

## invoice_status_enum

```sql
CREATE TYPE invoice_status_enum AS ENUM (

'draft',

'issued',

'paid',

'overdue',

'cancelled'
);
```

---

## inventory_movement_enum

```sql
CREATE TYPE inventory_movement_enum AS ENUM (

'receipt',

'production',

'sale',

'adjustment',

'transfer',

'wastage'
);
```

---

## journal_entry_status_enum

```sql
CREATE TYPE journal_entry_status_enum AS ENUM (

'draft',

'posted',

'reversed'
);
```

---

# Standard Constraints

BakeFlow SHALL enforce:

```text
NOT NULL

UNIQUE

CHECK

PRIMARY KEY

FOREIGN KEY
```

Application validation SHALL not replace database constraints.

---

# Default Naming Prefixes

| Object | Prefix |
|----------|---------|
| Primary Key | pk_ |
| Foreign Key | fk_ |
| Unique | uq_ |
| Index | idx_ |
| Check | chk_ |
| Trigger | trg_ |
| Function | fn_ |
| Procedure | sp_ |
| View | vw_ |
| Materialized View | mv_ |

Every generated object SHALL follow these conventions.

---

# Default Migration Order

Every new environment SHALL initialize in the following order.

```text
Extensions

↓

Schemas

↓

Domains

↓

ENUM Types

↓

Core Tables

↓

Lookup Tables

↓

Relationships

↓

Constraints

↓

Indexes

↓

Views

↓

Triggers

↓

Functions

↓

RLS Policies

↓

Seed Data
```

This ordering SHALL remain deterministic.

---

# Foundation Validation Checklist

Before creating business tables, verify:

- PostgreSQL version supported.
- Required schemas created.
- Required extensions installed.
- UTC configured.
- UTF-8 enabled.
- Domains created.
- ENUM types created.
- Naming conventions adopted.
- UUID generation verified.

Foundation setup SHALL be completed successfully before continuing with application schema creation.

---

END OF CHUNK 2/42

Next:

Chunk 3/42 — Core Organization Schema Implementation (organization, branch, organization_settings, branch_settings, relationships, constraints, indexes & RLS)

Append this chunk immediately below Chunk 2/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
3/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 2/42

Status:
Continuation

========================================

# Part II — Core Organization Schema Implementation

## Purpose

This section implements the core organizational hierarchy upon which every BakeFlow module depends.

Every business record within BakeFlow SHALL ultimately belong to exactly one Organization.

Branch-aware records SHALL additionally belong to exactly one Branch.

This ownership model enables complete tenant isolation throughout the platform.

---

# Entity Relationship Overview

```text
Organization
        │
        ├──────── Branch
        │             │
        │             ├──── Employees
        │             ├──── Customers
        │             ├──── Orders
        │             ├──── Inventory
        │             └──── Production
        │
        └──────── Organization Settings
```

---

# Table — organization

## Purpose

Represents a single bakery business (tenant).

Every tenant SHALL own all operational data.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| business_name | VARCHAR(150) | No | — |
| legal_name | VARCHAR(200) | Yes | — |
| registration_number | VARCHAR(100) | Yes | — |
| tax_number | VARCHAR(100) | Yes | — |
| email | email_address | No | — |
| phone | phone_number | Yes | — |
| website | TEXT | Yes | — |
| logo_url | TEXT | Yes | — |
| currency_code | CHAR(3) | No | 'NGN' |
| timezone | VARCHAR(100) | No | 'Africa/Lagos' |
| status | organization_status_enum | No | 'active' |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Primary Key

```sql
PRIMARY KEY (id)
```

---

## Unique Constraints

```sql
UNIQUE (registration_number)

UNIQUE (tax_number)
```

Null values SHALL be permitted.

---

## Indexes

```text
idx_organization_business_name

idx_organization_status

idx_organization_email
```

---

# Table — branch

## Purpose

Represents a physical bakery location.

Examples include:

- Main Bakery
- Retail Store
- Warehouse
- Production Facility

Every Branch SHALL belong to exactly one Organization.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| branch_name | VARCHAR(150) | No | — |
| branch_code | VARCHAR(30) | No | — |
| address | TEXT | Yes | — |
| city | VARCHAR(100) | Yes | — |
| state | VARCHAR(100) | Yes | — |
| country | VARCHAR(100) | No | 'Nigeria' |
| postal_code | VARCHAR(20) | Yes | — |
| phone | phone_number | Yes | — |
| email | email_address | Yes | — |
| is_head_office | BOOLEAN | No | FALSE |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Primary Key

```sql
PRIMARY KEY (id)
```

---

## Foreign Keys

```sql
tenant_id

REFERENCES organization(id)

ON DELETE RESTRICT

ON UPDATE CASCADE
```

---

## Unique Constraints

Each organization SHALL have unique branch codes.

```sql
UNIQUE (

tenant_id,

branch_code

)
```

---

## Indexes

```text
idx_branch_organization

idx_branch_code

idx_branch_name

idx_branch_active
```

---

# Table — organization_setting

## Purpose

Stores organization-wide configuration values.

Business configuration SHALL remain data-driven rather than hard-coded.

---

## Columns

| Column | Type | Nullable |
|---------|------|----------|
| id | UUID | No |
| tenant_id | UUID | No |
| setting_key | VARCHAR(100) | No |
| setting_value | JSONB | No |
| description | TEXT | Yes |
| created_at | TIMESTAMPTZ | No |
| updated_at | TIMESTAMPTZ | No |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

setting_key

)
```

---

## Indexes

```text
idx_org_setting_org

idx_org_setting_key
```

---

# Table — branch_setting

## Purpose

Overrides organization settings for individual branches.

Branch configuration SHALL inherit organization defaults unless overridden.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| branch_id | UUID |
| setting_key | VARCHAR(100) |
| setting_value | JSONB |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Unique Constraint

```sql
UNIQUE (

branch_id,

setting_key

)
```

---

# Organization Ownership Rule

Every business entity SHALL contain:

```sql
tenant_id UUID
NOT NULL
```

Examples:

```text
customer

supplier

employee

product

recipe

warehouse

invoice

payment

journal_entry
```

Organization ownership SHALL never be optional.

---

# Branch Ownership Rule

Branch-aware entities SHALL additionally contain:

```sql
branch_id UUID
NOT NULL
```

Examples:

```text
order

invoice

inventory

production_batch

expense

delivery

cash_transaction
```

Global entities SHALL omit branch ownership.

---

# Foreign Key Standards

Every ownership relationship SHALL use:

```sql
ON UPDATE CASCADE

ON DELETE RESTRICT
```

Business history SHALL never be unintentionally deleted.

---

# Row-Level Security

Both tables SHALL enable RLS.

```sql
ALTER TABLE organization

ENABLE ROW LEVEL SECURITY;
```

```sql
ALTER TABLE branch

ENABLE ROW LEVEL SECURITY;
```

---

# Organization Policy

Authenticated users SHALL only access their assigned organization.

Example policy:

```sql
tenant_id = auth.jwt()->>'tenant_id'
```

Implementation MAY use helper functions for readability.

---

# Branch Policy

Users SHALL only access branches belonging to their organization.

Cross-organization access SHALL remain impossible.

---

# Trigger Requirements

The following trigger SHALL be attached to:

- organization
- branch
- organization_setting
- branch_setting

```text
trg_update_timestamp
```

Purpose:

Automatically update:

```sql
updated_at
```

on every modification.

---

# Recommended Trigger Function

```sql
fn_update_timestamp()
```

Implementation details are defined later within the Functions section.

---

# Seed Data

Initial organization SHALL NOT be automatically created.

Organizations SHALL be created during onboarding.

The first branch SHALL automatically become:

```text
Head Office
```

unless specified otherwise.

---

# Validation Checklist

The Organization schema SHALL verify:

- UUID primary keys.
- Foreign key integrity.
- Unique branch codes.
- Organization ownership.
- Branch ownership.
- RLS enabled.
- Timestamp triggers attached.
- Required indexes created.

The Organization module SHALL be fully operational before implementing user and employee management.

---

END OF CHUNK 3/42

Next:

Chunk 4/42 — User, Employee, Role & Permission Schema Implementation (Supabase Auth Integration, RBAC Tables, Relationships, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 3/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
4/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 3/42

Status:
Continuation

========================================

# User, Employee, Role & Permission Schema Implementation

## Purpose

This section defines the complete implementation of BakeFlow's authentication and authorization model.

BakeFlow uses **Supabase Authentication** for identity management while maintaining its own business entities for employees, roles, and permissions.

Authentication SHALL remain separated from business data.

---

# Authentication Architecture

```text
Supabase Auth

(auth.users)
        │
        │ 1:1
        ▼
User Profile
        │
        ▼
Employee
        │
        ▼
Employee Role
        │
        ▼
Role
        │
        ▼
Permissions
```

The `auth.users` table SHALL remain the authoritative identity store.

Business-specific information SHALL remain within the `public` schema.

---

# Table — user_profile

## Purpose

Extends Supabase's `auth.users` with application-specific information.

This table SHALL never duplicate authentication credentials.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | References auth.users(id) |
| tenant_id | UUID | No | — |
| employee_id | UUID | Yes | — |
| first_name | VARCHAR(100) | No | — |
| last_name | VARCHAR(100) | No | — |
| avatar_url | TEXT | Yes | — |
| phone | phone_number | Yes | — |
| last_login_at | TIMESTAMPTZ | Yes | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Primary Key

```sql
PRIMARY KEY (id)
```

---

## Foreign Keys

```sql
id
REFERENCES auth.users(id)
ON DELETE CASCADE
```

```sql
tenant_id
REFERENCES organization(id)
ON DELETE RESTRICT
```

```sql
employee_id
REFERENCES employee(id)
ON DELETE SET NULL
```

---

## Indexes

```text
idx_user_profile_org

idx_user_profile_employee
```

---

# Table — employee

## Purpose

Represents a staff member working within an organization.

Employees MAY or MAY NOT possess login credentials.

Examples:

- Baker
- Cashier
- Driver
- Production Manager
- Accountant

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| branch_id | UUID | No | — |
| employee_number | VARCHAR(30) | No | — |
| first_name | VARCHAR(100) | No | — |
| last_name | VARCHAR(100) | No | — |
| email | email_address | Yes | — |
| phone | phone_number | Yes | — |
| job_title | VARCHAR(100) | Yes | — |
| employment_status | employee_status_enum | No | 'active' |
| hire_date | DATE | Yes | — |
| termination_date | DATE | Yes | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

employee_number

)
```

---

## Foreign Keys

```sql
tenant_id
→ organization(id)
```

```sql
branch_id
→ branch(id)
```

---

## Indexes

```text
idx_employee_org

idx_employee_branch

idx_employee_status

idx_employee_name

idx_employee_number
```

---

# Table — role

## Purpose

Defines reusable security roles.

Examples include:

- Owner
- Manager
- Cashier
- Baker
- Driver
- Accountant
- Sales Representative

Roles SHALL remain organization-specific to support customization.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| role_name | VARCHAR(100) |
| description | TEXT |
| is_system | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

role_name

)
```

---

## Indexes

```text
idx_role_org

idx_role_name
```

---

# Table — permission

## Purpose

Stores every application permission.

Permissions SHALL remain platform-managed.

Organizations SHALL assign—not create—permissions.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| permission_code | VARCHAR(100) |
| permission_name | VARCHAR(150) |
| module | VARCHAR(100) |
| description | TEXT |
| created_at | TIMESTAMPTZ |

---

## Example Permission Codes

```text
customer.view

customer.create

customer.update

customer.delete

inventory.adjust

production.start

production.complete

sales.invoice.create

finance.post

reports.view

settings.manage
```

---

## Unique Constraint

```sql
UNIQUE(permission_code)
```

---

# Table — role_permission

## Purpose

Maps permissions to roles.

Many-to-many relationship.

---

## Columns

| Column | Type |
|---------|------|
| role_id | UUID |
| permission_id | UUID |
| created_at | TIMESTAMPTZ |

---

## Composite Primary Key

```sql
PRIMARY KEY (

role_id,

permission_id

)
```

---

# Table — employee_role

## Purpose

Assigns one or more roles to employees.

Supports multiple concurrent roles.

Example:

```text
Manager

+

Accountant
```

---

## Columns

| Column | Type |
|---------|------|
| employee_id | UUID |
| role_id | UUID |
| assigned_at | TIMESTAMPTZ |
| assigned_by | UUID |

---

## Composite Primary Key

```sql
PRIMARY KEY (

employee_id,

role_id

)
```

---

# Relationship Summary

```text
Organization

↓

Branch

↓

Employee

↓

Employee Role

↓

Role

↓

Role Permission

↓

Permission
```

This hierarchy SHALL remain unchanged.

---

# Required Foreign Keys

The following foreign key relationships SHALL exist:

```text
employee.tenant_id

→ organization.id
```

```text
employee.branch_id

→ branch.id
```

```text
role.tenant_id

→ organization.id
```

```text
employee_role.employee_id

→ employee.id
```

```text
employee_role.role_id

→ role.id
```

```text
role_permission.role_id

→ role.id
```

```text
role_permission.permission_id

→ permission.id
```

---

# Recommended Indexes

Additional indexes:

```text
idx_role_permission_role

idx_role_permission_permission

idx_employee_role_employee

idx_employee_role_role
```

These indexes SHALL optimize authorization lookups.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
user_profile

employee

role

employee_role
```

The `permission` table MAY remain globally readable by authenticated users.

---

# Example Employee Policy

Employees SHALL only access records belonging to their organization.

Example condition:

```sql
tenant_id =
current_tenant_id()
```

Implementation MAY use helper SQL functions.

---

# Example Role Policy

Roles SHALL remain isolated per organization.

Cross-tenant role visibility SHALL be prohibited.

---

# Trigger Requirements

The following tables SHALL attach:

```text
trg_update_timestamp
```

Tables:

- user_profile
- employee
- role

Junction tables SHALL not require timestamp update triggers.

---

# Seed Data

Initial seed roles SHALL include:

```text
Owner

Manager

Cashier

Baker

Driver

Sales

Production Manager

Inventory Officer

Accountant
```

---

# Initial Permission Set

Seed permissions SHALL cover:

- Customers
- Products
- Recipes
- Production
- Inventory
- Orders
- Invoices
- Payments
- Expenses
- Reports
- Users
- Settings

Additional permissions SHALL be introduced through future migrations.

---

# Validation Checklist

The User & Employee module SHALL verify:

- Supabase Auth integration.
- Employee records created.
- Role hierarchy operational.
- Permission mapping complete.
- Employee multi-role support.
- RLS enabled.
- Foreign keys enforced.
- Authorization indexes created.

This module SHALL be completed before implementing customer and supplier management.

---

END OF CHUNK 4/42

Next:

Chunk 5/42 — Customer & Supplier Schema Implementation (Tables, Relationships, Constraints, Search Indexes, Contact Information & RLS)

Append this chunk immediately below Chunk 4/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
5/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 4/42

Status:
Continuation

========================================

# Customer & Supplier Schema Implementation

## Purpose

This section implements the Customer and Supplier modules.

These entities represent external business relationships and form the foundation for:

- Sales
- Quotations
- Orders
- Deliveries
- Invoicing
- Payments
- Procurement
- Purchase Orders
- Inventory Receipts

Every Customer and Supplier SHALL belong to exactly one Organization.

---

# Entity Relationship Overview

```text
Organization
        │
        ├──────── Customer
        │              │
        │              ├──── Customer Address
        │              ├──── Customer Contact
        │              ├──── Orders
        │              ├──── Quotations
        │              └──── Invoices
        │
        └──────── Supplier
                       │
                       ├──── Purchase Orders
                       ├──── Inventory Receipts
                       └──── Payments
```

---

# Table — customer

## Purpose

Represents an individual or business purchasing products or services.

Customers SHALL remain organization-owned.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| customer_code | VARCHAR(30) | No | — |
| customer_type | VARCHAR(20) | No | 'individual' |
| business_name | VARCHAR(200) | Yes | — |
| first_name | VARCHAR(100) | Yes | — |
| last_name | VARCHAR(100) | Yes | — |
| email | email_address | Yes | — |
| phone | phone_number | No | — |
| alternate_phone | phone_number | Yes | — |
| tax_number | VARCHAR(100) | Yes | — |
| credit_limit | money_amount | No | 0 |
| current_balance | money_amount | No | 0 |
| is_credit_allowed | BOOLEAN | No | FALSE |
| is_active | BOOLEAN | No | TRUE |
| notes | TEXT | Yes | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Business Rules

Individual customers SHALL populate:

- first_name
- last_name

Corporate customers SHALL populate:

- business_name

At least one of these SHALL always exist.

---

## Primary Key

```sql
PRIMARY KEY (id)
```

---

## Unique Constraints

```sql
UNIQUE (

tenant_id,

customer_code

)
```

---

## Check Constraint

```sql
CHECK (

credit_limit >= 0

)
```

---

## Foreign Keys

```sql
tenant_id

REFERENCES organization(id)

ON DELETE RESTRICT

ON UPDATE CASCADE
```

---

## Recommended Indexes

```text
idx_customer_org

idx_customer_code

idx_customer_phone

idx_customer_email

idx_customer_active

idx_customer_business_name
```

---

# Table — customer_address

## Purpose

Stores one or more customer addresses.

Supported address types include:

- Billing
- Shipping
- Home
- Office

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| customer_id | UUID |
| address_type | VARCHAR(30) |
| address_line_1 | TEXT |
| address_line_2 | TEXT |
| city | VARCHAR(100) |
| state | VARCHAR(100) |
| country | VARCHAR(100) |
| postal_code | VARCHAR(20) |
| is_default | BOOLEAN |
| created_at | TIMESTAMPTZ |

---

## Foreign Key

```sql
customer_id

REFERENCES customer(id)

ON DELETE CASCADE
```

---

## Indexes

```text
idx_customer_address_customer

idx_customer_address_default
```

---

# Table — customer_contact

## Purpose

Stores multiple contact persons for corporate customers.

Examples:

- Purchasing Manager
- Accountant
- Store Manager

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| customer_id | UUID |
| full_name | VARCHAR(150) |
| position | VARCHAR(100) |
| phone | phone_number |
| email | email_address |
| is_primary | BOOLEAN |
| created_at | TIMESTAMPTZ |

---

## Foreign Key

```sql
customer_id

REFERENCES customer(id)

ON DELETE CASCADE
```

---

# Table — supplier

## Purpose

Represents ingredient, packaging, equipment, or service providers.

Suppliers SHALL remain organization-owned.

---

## Columns

| Column | Type | Nullable |
|---------|------|----------|
| id | UUID | No |
| tenant_id | UUID | No |
| supplier_code | VARCHAR(30) | No |
| business_name | VARCHAR(200) | No |
| contact_person | VARCHAR(150) | Yes |
| email | email_address | Yes |
| phone | phone_number | No |
| alternate_phone | phone_number | Yes |
| address | TEXT | Yes |
| city | VARCHAR(100) | Yes |
| state | VARCHAR(100) | Yes |
| country | VARCHAR(100) | No |
| tax_number | VARCHAR(100) | Yes |
| payment_terms_days | INTEGER | No |
| current_balance | money_amount | No |
| is_active | BOOLEAN | No |
| notes | TEXT | Yes |
| created_at | TIMESTAMPTZ | No |
| updated_at | TIMESTAMPTZ | No |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

supplier_code

)
```

---

## Check Constraints

```sql
CHECK (

payment_terms_days >= 0

)
```

```sql
CHECK (

current_balance >= 0

)
```

---

## Recommended Indexes

```text
idx_supplier_org

idx_supplier_code

idx_supplier_name

idx_supplier_phone

idx_supplier_active
```

---

# Search Optimization

Customer searches SHALL support:

- Customer Code
- Business Name
- First Name
- Last Name
- Phone Number
- Email Address

Supplier searches SHALL support:

- Supplier Code
- Business Name
- Contact Person
- Phone
- Email

Implementations SHOULD use:

```sql
GIN

+

pg_trgm
```

for fuzzy text search.

---

# Full-Text Search Index Example

Recommended implementation:

```sql
CREATE INDEX idx_customer_search

ON customer

USING GIN (

to_tsvector(

'english',

coalesce(business_name,'')

||

' '

||

coalesce(first_name,'')

||

' '

||

coalesce(last_name,'')

)

);
```

Equivalent indexes SHOULD be created for suppliers.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
customer

customer_address

customer_contact

supplier
```

---

# Customer Policy

Authenticated users SHALL only access customers belonging to their organization.

Example condition:

```sql
tenant_id = current_tenant_id()
```

---

# Supplier Policy

Suppliers SHALL remain completely isolated between organizations.

Cross-tenant supplier visibility SHALL remain prohibited.

---

# Trigger Requirements

Timestamp update triggers SHALL be attached to:

- customer
- supplier

Address and contact tables SHALL not require automatic `updated_at` triggers unless an `updated_at` column is introduced.

---

# Seed Data

Customer and Supplier tables SHALL NOT include default records.

All records SHALL originate from user onboarding or business operations.

---

# Validation Checklist

The Customer & Supplier module SHALL verify:

- Organization ownership enforced.
- Customer codes unique.
- Supplier codes unique.
- Credit limits validated.
- Payment terms validated.
- Search indexes created.
- Foreign keys enforced.
- RLS enabled.
- Timestamp triggers attached.

The Customer & Supplier module SHALL be completed before implementing Product, Category, Recipe, and Production management.

---

END OF CHUNK 5/42

Next:

Chunk 6/42 — Product Catalog Schema Implementation (Categories, Products, Product Variants, Units of Measure, Pricing, Costing, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 5/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
6/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 5/42

Status:
Continuation

========================================

# Product Catalog Schema Implementation

## Purpose

This section defines the implementation of BakeFlow's Product Catalog.

The Product Catalog provides the foundation for:

- Sales
- Production
- Recipes
- Inventory
- Cost Accounting
- Pricing
- Reporting

Every product SHALL belong to exactly one Organization.

Product definitions SHALL remain independent of inventory quantities.

---

# Entity Relationship Overview

```text
Organization
        │
        ├──────── Product Category
        │               │
        │               ▼
        │            Product
        │               │
        │               ├──── Product Price
        │               ├──── Product Image
        │               ├──── Product Variant
        │               ├──── Recipe
        │               └──── Inventory Item
        │
        └──────── Unit of Measure
```

---

# Table — product_category

## Purpose

Groups products into logical classifications.

Examples include:

- Bread
- Cakes
- Pastries
- Snacks
- Drinks
- Packaging

Categories SHALL support reporting and filtering.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| category_name | VARCHAR(100) | No | — |
| category_code | VARCHAR(30) | No | — |
| description | TEXT | Yes | — |
| display_order | INTEGER | No | 0 |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

category_code

)
```

---

## Indexes

```text
idx_product_category_org

idx_product_category_name

idx_product_category_active
```

---

# Table — unit_of_measure

## Purpose

Defines standardized measurement units.

Examples:

```text
Piece

Loaf

Pack

Tray

Carton

Kilogram

Gram

Litre

Millilitre
```

The same unit definitions SHALL be reused throughout the platform.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| unit_name | VARCHAR(50) |
| unit_symbol | VARCHAR(20) |
| decimal_precision | SMALLINT |
| is_base_unit | BOOLEAN |
| created_at | TIMESTAMPTZ |

---

## Example Records

| Unit | Symbol |
|------|--------|
| Piece | pcs |
| Kilogram | kg |
| Gram | g |
| Litre | L |
| Millilitre | ml |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

unit_symbol

)
```

---

# Table — product

## Purpose

Represents every sellable finished product.

Examples include:

- Small Bread
- Large Bread
- Meat Pie
- Doughnut
- Birthday Cake

Products SHALL remain independent from inventory movements.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| category_id | UUID | No | — |
| default_unit_id | UUID | No | — |
| product_code | VARCHAR(40) | No | — |
| product_name | VARCHAR(150) | No | — |
| description | TEXT | Yes | — |
| barcode | VARCHAR(100) | Yes | — |
| sku | VARCHAR(100) | Yes | — |
| standard_cost | money_amount | No | 0 |
| selling_price | money_amount | No | 0 |
| vat_rate | NUMERIC(5,2) | No | 0 |
| reorder_level | inventory_quantity | No | 0 |
| shelf_life_days | INTEGER | Yes | — |
| is_produced | BOOLEAN | No | TRUE |
| is_sellable | BOOLEAN | No | TRUE |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Foreign Keys

```sql
tenant_id
REFERENCES organization(id)
```

```sql
category_id
REFERENCES product_category(id)
```

```sql
default_unit_id
REFERENCES unit_of_measure(id)
```

---

## Unique Constraints

```sql
UNIQUE (

tenant_id,

product_code

)
```

Optional fields such as `barcode` and `sku` SHOULD also be unique within an organization when populated.

---

## Check Constraints

```sql
CHECK (

standard_cost >= 0

)
```

```sql
CHECK (

selling_price >= 0

)
```

```sql
CHECK (

vat_rate >= 0

)
```

```sql
CHECK (

reorder_level >= 0

)
```

---

## Recommended Indexes

```text
idx_product_org

idx_product_category

idx_product_code

idx_product_name

idx_product_barcode

idx_product_sku

idx_product_sellable

idx_product_active
```

---

# Table — product_price

## Purpose

Maintains product price history.

This table allows future price changes without overwriting historical values.

Sales documents SHALL preserve the selling price effective at the time of sale.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| product_id | UUID |
| selling_price | money_amount |
| effective_from | TIMESTAMPTZ |
| effective_to | TIMESTAMPTZ |
| created_by | UUID |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Only one active price SHALL exist per product at any point in time.

Historical records SHALL never be modified.

---

## Recommended Indexes

```text
idx_product_price_product

idx_product_price_effective
```

---

# Table — product_variant

## Purpose

Supports multiple variants of a single product.

Examples:

```text
Bread

├── Small

├── Medium

└── Large
```

or

```text
Cake

├── Vanilla

├── Chocolate

└── Red Velvet
```

Organizations not requiring variants MAY leave this table unused.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| product_id | UUID |
| variant_name | VARCHAR(100) |
| sku | VARCHAR(100) |
| barcode | VARCHAR(100) |
| additional_cost | money_amount |
| selling_price | money_amount |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |

---

## Foreign Key

```sql
product_id

REFERENCES product(id)

ON DELETE CASCADE
```

---

## Indexes

```text
idx_product_variant_product

idx_product_variant_sku

idx_product_variant_barcode
```

---

# Table — product_image

## Purpose

Associates one or more images with a product.

Images SHALL be stored in Supabase Storage.

Only metadata SHALL be stored in PostgreSQL.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| product_id | UUID |
| storage_path | TEXT |
| display_order | INTEGER |
| is_primary | BOOLEAN |
| created_at | TIMESTAMPTZ |

---

## Foreign Key

```sql
product_id

REFERENCES product(id)

ON DELETE CASCADE
```

---

# Search Optimization

Products SHALL support searching by:

- Product Name
- Product Code
- SKU
- Barcode
- Category

Fuzzy searching SHOULD utilize:

```sql
GIN

+

pg_trgm
```

---

# Full-Text Search Index

Recommended implementation:

```sql
CREATE INDEX idx_product_search

ON product

USING GIN (

to_tsvector(

'english',

coalesce(product_name,'')

||

' '

||

coalesce(description,'')

)

);
```

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
product_category

unit_of_measure

product

product_price

product_variant

product_image
```

Users SHALL only access records belonging to their organization.

---

# Trigger Requirements

The following tables SHALL attach:

```text
trg_update_timestamp
```

- product_category
- product
- product_variant

Historical tables such as `product_price` SHALL remain immutable after creation and SHALL not require update triggers.

---

# Seed Data

Default Unit of Measure records SHOULD be seeded during initial deployment.

Product Categories MAY be seeded with common bakery classifications but SHALL remain editable by authorized users.

Products SHALL NOT be seeded.

---

# Validation Checklist

The Product Catalog module SHALL verify:

- Organization ownership enforced.
- Category relationships valid.
- Unit of Measure relationships valid.
- Product codes unique.
- Non-negative pricing enforced.
- Search indexes created.
- Price history supported.
- Product variants supported.
- RLS enabled.
- Timestamp triggers attached.

The Product Catalog SHALL be completed before implementing Recipes, Ingredients, and Production.

---

END OF CHUNK 6/42

Next:

Chunk 7/42 — Recipe, Ingredient & Production Formula Schema Implementation (Recipes, Recipe Versions, Ingredients, Formula Lines, Yield Calculations, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 6/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
7/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 6/42

Status:
Continuation

========================================

# Recipe, Ingredient & Production Formula Schema Implementation

## Purpose

This section defines the implementation of BakeFlow's production formulas.

Recipes SHALL define how finished products are manufactured by specifying:

- Ingredients
- Quantities
- Units of Measure
- Expected Yield
- Production Cost
- Wastage
- Recipe Versions

Recipes SHALL serve as production blueprints.

Historical recipes SHALL never be overwritten.

---

# Entity Relationship Overview

```text
Organization
        │
        ├──────── Ingredient
        │
        ├──────── Recipe
        │           │
        │           ├──── Recipe Version
        │           │           │
        │           │           └──── Recipe Line
        │           │
        │           └──── Product
        │
        └──────── Unit of Measure
```

---

# Table — ingredient

## Purpose

Represents every raw material consumed during production.

Examples include:

- Flour
- Sugar
- Butter
- Eggs
- Salt
- Yeast
- Milk
- Cocoa Powder
- Vegetable Oil

Ingredients SHALL also participate in inventory management.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| default_unit_id | UUID | No | — |
| ingredient_code | VARCHAR(30) | No | — |
| ingredient_name | VARCHAR(150) | No | — |
| description | TEXT | Yes | — |
| standard_cost | money_amount | No | 0 |
| reorder_level | inventory_quantity | No | 0 |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Foreign Keys

```sql
tenant_id
REFERENCES organization(id)
```

```sql
default_unit_id
REFERENCES unit_of_measure(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

ingredient_code

)
```

---

## Check Constraints

```sql
CHECK (

standard_cost >= 0

)
```

```sql
CHECK (

reorder_level >= 0

)
```

---

## Recommended Indexes

```text
idx_ingredient_org

idx_ingredient_code

idx_ingredient_name

idx_ingredient_active
```

---

# Table — recipe

## Purpose

Represents the master recipe for a finished product.

A recipe SHALL identify:

- The finished product.
- The current active version.
- Production status.

Recipe details SHALL be maintained through version records.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| product_id | UUID |
| recipe_code | VARCHAR(40) |
| recipe_name | VARCHAR(150) |
| current_version | INTEGER |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Foreign Keys

```sql
tenant_id
REFERENCES organization(id)
```

```sql
product_id
REFERENCES product(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

recipe_code

)
```

---

## Recommended Indexes

```text
idx_recipe_org

idx_recipe_product

idx_recipe_code
```

---

# Table — recipe_version

## Purpose

Stores immutable versions of each recipe.

Recipe modifications SHALL create a new version instead of modifying existing records.

This preserves historical production accuracy.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| recipe_id | UUID |
| version_number | INTEGER |
| expected_yield | inventory_quantity |
| yield_unit_id | UUID |
| estimated_cost | money_amount |
| expected_wastage_percent | NUMERIC(5,2) |
| effective_from | DATE |
| effective_to | DATE |
| approved_by | UUID |
| approved_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Version numbers SHALL increase sequentially.

Historical versions SHALL never be modified after approval.

---

## Check Constraints

```sql
CHECK (

expected_yield > 0

)
```

```sql
CHECK (

expected_wastage_percent >= 0

)
```

---

## Unique Constraint

```sql
UNIQUE (

recipe_id,

version_number

)
```

---

## Recommended Indexes

```text
idx_recipe_version_recipe

idx_recipe_version_effective
```

---

# Table — recipe_line

## Purpose

Defines the ingredients required for a specific recipe version.

Each line represents one ingredient.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| recipe_version_id | UUID |
| ingredient_id | UUID |
| unit_id | UUID |
| quantity_required | inventory_quantity |
| wastage_percent | NUMERIC(5,2) |
| sequence_number | INTEGER |
| notes | TEXT |

---

## Foreign Keys

```sql
recipe_version_id
REFERENCES recipe_version(id)
```

```sql
ingredient_id
REFERENCES ingredient(id)
```

```sql
unit_id
REFERENCES unit_of_measure(id)
```

---

## Check Constraints

```sql
CHECK (

quantity_required > 0

)
```

```sql
CHECK (

wastage_percent >= 0

)
```

---

## Unique Constraint

```sql
UNIQUE (

recipe_version_id,

ingredient_id

)
```

---

## Recommended Indexes

```text
idx_recipe_line_recipe

idx_recipe_line_ingredient
```

---

# Yield Calculation

Expected Yield SHALL represent the quantity of finished product produced by the recipe.

Example:

```text
Recipe:

White Bread

Ingredients:

10 kg Flour

6 L Water

200 g Salt

Expected Yield:

120 Loaves
```

Yield SHALL support production planning and costing.

---

# Cost Calculation

Estimated Recipe Cost SHALL equal:

```text
Σ

(

Ingredient Quantity

×

Current Ingredient Cost

)
```

Production execution SHALL record actual costs independently.

---

# Wastage Handling

Two wastage levels SHALL be supported.

## Recipe-Level

Represents expected overall production loss.

Example:

```text
2%
```

---

## Ingredient-Level

Represents expected waste for a specific ingredient.

Example:

```text
Butter:

3%

Flour:

0.5%
```

---

# Version Lifecycle

Canonical lifecycle:

```text
Draft

↓

Approved

↓

Effective

↓

Superseded

↓

Archived
```

Only one version SHALL be effective at a given time.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
ingredient

recipe

recipe_version

recipe_line
```

All records SHALL remain organization-owned.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- ingredient
- recipe

Version and recipe line tables SHALL remain immutable after approval and SHALL not require update triggers.

---

# Search Optimization

Recipes SHALL support searching by:

- Recipe Code
- Recipe Name
- Product Name

Ingredients SHALL support searching by:

- Ingredient Code
- Ingredient Name

Implementations SHOULD utilize `pg_trgm` and GIN indexes where appropriate.

---

# Seed Data

Ingredient and Recipe tables SHALL NOT include default production data.

Organizations SHALL define recipes during initial system configuration.

Default Units of Measure from Chunk 6 SHALL be reused.

---

# Validation Checklist

The Recipe & Ingredient module SHALL verify:

- Ingredient ownership enforced.
- Recipe linked to a product.
- Version history supported.
- Immutable recipe versions.
- Positive ingredient quantities enforced.
- Yield validation implemented.
- Cost calculation supported.
- Search indexes created.
- RLS enabled.
- Timestamp triggers attached where applicable.

The Recipe module SHALL be completed before implementing Production Batches and Manufacturing Execution.

---

END OF CHUNK 7/42

Next:

Chunk 8/42 — Production Execution Schema Implementation (Production Batches, Consumption, Output, Wastage, Quality Control, Batch Traceability, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 7/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
8/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 7/42

Status:
Continuation

========================================

# Production Execution Schema Implementation

## Purpose

This section defines the implementation of BakeFlow's production execution system.

Production execution transforms recipe definitions into actual manufacturing records.

Every production run SHALL produce a complete and immutable production history including:

- Batch creation
- Ingredient consumption
- Finished goods output
- Wastage
- Employee accountability
- Cost tracking
- Quality control

Production SHALL be fully traceable.

---

# Entity Relationship Overview

```text
Recipe Version
        │
        ▼
Production Batch
        │
        ├──────── Production Consumption
        │
        ├──────── Production Output
        │
        ├──────── Production Wastage
        │
        ├──────── Quality Inspection
        │
        └──────── Inventory Movements
```

---

# Table — production_batch

## Purpose

Represents a single manufacturing execution event.

Each production batch SHALL represent one completed or in-progress production run.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| branch_id | UUID | No | — |
| recipe_version_id | UUID | No | — |
| batch_number | VARCHAR(40) | No | — |
| production_date | DATE | No | CURRENT_DATE |
| scheduled_start_at | TIMESTAMPTZ | Yes | — |
| actual_start_at | TIMESTAMPTZ | Yes | — |
| completed_at | TIMESTAMPTZ | Yes | — |
| status | VARCHAR(30) | No | 'draft' |
| planned_quantity | inventory_quantity | No | — |
| actual_quantity | inventory_quantity | Yes | — |
| production_cost | money_amount | No | 0 |
| notes | TEXT | Yes | — |
| created_by | UUID | No | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Status Values

Supported statuses:

```text
draft

scheduled

in_progress

completed

cancelled
```

---

## Foreign Keys

```sql
tenant_id
REFERENCES organization(id)
```

```sql
branch_id
REFERENCES branch(id)
```

```sql
recipe_version_id
REFERENCES recipe_version(id)
```

```sql
created_by
REFERENCES employee(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

batch_number

)
```

---

## Recommended Indexes

```text
idx_production_batch_org

idx_production_batch_branch

idx_production_batch_date

idx_production_batch_status

idx_production_batch_recipe

idx_production_batch_number
```

---

# Table — production_consumption

## Purpose

Records the actual ingredients consumed during production.

This table SHALL represent actual consumption rather than planned recipe quantities.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| production_batch_id | UUID |
| ingredient_id | UUID |
| inventory_movement_id | UUID |
| quantity_consumed | inventory_quantity |
| unit_cost | money_amount |
| total_cost | money_amount |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Consumption SHALL generate corresponding inventory movements.

Consumption SHALL remain immutable after production completion.

---

## Foreign Keys

```sql
production_batch_id
REFERENCES production_batch(id)
```

```sql
ingredient_id
REFERENCES ingredient(id)
```

---

## Check Constraints

```sql
CHECK (

quantity_consumed > 0

)
```

---

## Recommended Indexes

```text
idx_production_consumption_batch

idx_production_consumption_ingredient
```

---

# Table — production_output

## Purpose

Records finished goods produced during a production batch.

Supports:

- Primary products
- Secondary products
- By-products

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| production_batch_id | UUID |
| product_id | UUID |
| quantity_produced | inventory_quantity |
| unit_cost | money_amount |
| total_cost | money_amount |
| expiration_date | DATE |
| created_at | TIMESTAMPTZ |

---

## Foreign Keys

```sql
production_batch_id
REFERENCES production_batch(id)
```

```sql
product_id
REFERENCES product(id)
```

---

## Check Constraints

```sql
CHECK (

quantity_produced > 0

)
```

---

## Recommended Indexes

```text
idx_production_output_batch

idx_production_output_product
```

---

# Table — production_wastage

## Purpose

Captures production losses occurring during manufacturing.

Examples include:

- Burnt bread
- Damaged dough
- Overcooked products
- Ingredient spoilage
- Packaging defects

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| production_batch_id | UUID |
| ingredient_id | UUID |
| product_id | UUID |
| wastage_quantity | inventory_quantity |
| wastage_reason | VARCHAR(100) |
| estimated_cost | money_amount |
| recorded_by | UUID |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Either:

```text
ingredient_id
```

or

```text
product_id
```

SHALL be populated.

Both SHALL NOT be NULL simultaneously.

---

## Check Constraint

```sql
CHECK (

ingredient_id IS NOT NULL

OR

product_id IS NOT NULL

)
```

---

## Recommended Indexes

```text
idx_production_wastage_batch

idx_production_wastage_reason
```

---

# Table — production_quality_check

## Purpose

Records quality inspections performed during or after production.

Supports bakery quality assurance processes.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| production_batch_id | UUID |
| inspected_by | UUID |
| inspection_time | TIMESTAMPTZ |
| passed | BOOLEAN |
| score | NUMERIC(5,2) |
| remarks | TEXT |
| created_at | TIMESTAMPTZ |

---

## Example Quality Criteria

- Appearance
- Weight
- Shape
- Texture
- Colour
- Internal Temperature
- Packaging
- Label Accuracy

Quality scoring methodology SHALL remain configurable.

---

## Foreign Keys

```sql
production_batch_id
REFERENCES production_batch(id)
```

```sql
inspected_by
REFERENCES employee(id)
```

---

## Recommended Indexes

```text
idx_quality_batch

idx_quality_passed
```

---

# Batch Traceability

Each production batch SHALL remain traceable to:

- Organization
- Branch
- Recipe Version
- Ingredients Used
- Employees
- Output Produced
- Inventory Movements
- Quality Inspection

Traceability SHALL support operational audits and product recalls.

---

# Cost Calculation

Actual production cost SHALL equal:

```text
Ingredient Consumption

+

Direct Adjustments

+

Recorded Wastage
```

Recipe estimates SHALL not overwrite actual production costs.

---

# Inventory Integration

Completing a production batch SHALL automatically generate:

**Consumption Movements**

```text
Raw Materials

↓

Decrease Inventory
```

**Output Movements**

```text
Finished Goods

↓

Increase Inventory
```

Inventory SHALL always be movement-driven.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
production_batch

production_consumption

production_output

production_wastage

production_quality_check
```

Users SHALL only access production data belonging to their organization.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- production_batch

Production detail tables SHALL remain append-only after batch completion and SHALL not require automatic update triggers.

---

# Batch Completion Rules

A production batch SHALL only transition to `completed` when:

- All ingredient consumption has been recorded.
- Finished goods output has been recorded.
- Inventory movements have been successfully generated.
- Quality inspection requirements have been satisfied (if enabled).
- Production cost has been finalized.

Incomplete batches SHALL not update finished goods inventory.

---

# Validation Checklist

The Production Execution module SHALL verify:

- Batch numbers unique.
- Recipe version linked.
- Consumption recorded.
- Output recorded.
- Wastage supported.
- Quality inspections supported.
- Inventory integration enforced.
- Cost calculation supported.
- Batch traceability complete.
- RLS enabled.
- Timestamp triggers attached.

The Production Execution module SHALL be completed before implementing Inventory Ledger and Warehouse Management.

---

END OF CHUNK 8/42

Next:

Chunk 9/42 — Inventory & Warehouse Schema Implementation (Warehouses, Inventory Items, Inventory Ledger, Stock Adjustments, Transfers, Cycle Counts, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 8/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
9/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 8/42

Status:
Continuation

========================================

# Inventory & Warehouse Schema Implementation

## Purpose

This section defines BakeFlow's warehouse and inventory implementation.

Inventory SHALL be entirely movement-driven.

Stock balances SHALL always be derived from recorded inventory movements rather than manually maintained quantities.

The Inventory module SHALL support:

- Multiple Warehouses
- Raw Materials
- Finished Goods
- Packaging Materials
- Stock Transfers
- Stock Adjustments
- Stock Counts
- Inventory Ledger
- Cost Tracking

Inventory SHALL remain fully auditable.

---

# Entity Relationship Overview

```text
Organization
        │
        ├──────── Warehouse
        │             │
        │             ├──── Inventory Item
        │             │
        │             ├──── Inventory Movement
        │             │
        │             ├──── Stock Transfer
        │             │
        │             └──── Stock Count
        │
        ├──────── Ingredient
        │
        └──────── Product
```

---

# Table — warehouse

## Purpose

Represents a physical inventory location.

Examples:

- Main Warehouse
- Bakery Store
- Production Store
- Packaging Store
- Retail Outlet
- Transit Store

Every warehouse SHALL belong to one Organization.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| branch_id | UUID | No | — |
| warehouse_code | VARCHAR(30) | No | — |
| warehouse_name | VARCHAR(150) | No | — |
| warehouse_type | VARCHAR(30) | No | 'general' |
| address | TEXT | Yes | — |
| is_default | BOOLEAN | No | FALSE |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Warehouse Types

Supported values:

```text
raw_material

finished_goods

packaging

retail

transit

general
```

---

## Foreign Keys

```sql
tenant_id
REFERENCES organization(id)
```

```sql
branch_id
REFERENCES branch(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

warehouse_code

)
```

---

## Recommended Indexes

```text
idx_warehouse_org

idx_warehouse_branch

idx_warehouse_code

idx_warehouse_active
```

---

# Table — inventory_item

## Purpose

Represents an inventory-controlled item stored in a warehouse.

An inventory item MAY reference either:

- An Ingredient
- A Finished Product

The same product MAY exist in multiple warehouses.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| warehouse_id | UUID |
| ingredient_id | UUID |
| product_id | UUID |
| reorder_level | inventory_quantity |
| maximum_level | inventory_quantity |
| preferred_bin | VARCHAR(50) |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Business Rule

Exactly one of the following SHALL be populated:

```text
ingredient_id

OR

product_id
```

---

## Check Constraint

```sql
CHECK (

(ingredient_id IS NOT NULL)

<>

(product_id IS NOT NULL)

)
```

---

## Foreign Keys

```sql
warehouse_id
REFERENCES warehouse(id)
```

```sql
ingredient_id
REFERENCES ingredient(id)
```

```sql
product_id
REFERENCES product(id)
```

---

## Recommended Indexes

```text
idx_inventory_item_warehouse

idx_inventory_item_product

idx_inventory_item_ingredient
```

---

# Table — inventory_movement

## Purpose

Represents the immutable inventory ledger.

Every inventory increase or decrease SHALL generate exactly one inventory movement.

Inventory balances SHALL be reconstructed from this ledger.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| warehouse_id | UUID |
| inventory_item_id | UUID |
| movement_type | inventory_movement_enum |
| reference_table | VARCHAR(50) |
| reference_id | UUID |
| quantity_change | inventory_quantity |
| unit_cost | money_amount |
| total_cost | money_amount |
| movement_time | TIMESTAMPTZ |
| performed_by | UUID |
| notes | TEXT |
| created_at | TIMESTAMPTZ |

---

## Movement Types

Supported values:

```text
receipt

production

sale

adjustment

transfer

wastage
```

Additional movement types MAY be introduced through migrations.

---

## Business Rules

Inventory movements SHALL remain immutable.

Updates and deletions SHALL be prohibited after creation.

Corrections SHALL be recorded using compensating movements.

---

## Foreign Keys

```sql
warehouse_id
REFERENCES warehouse(id)
```

```sql
inventory_item_id
REFERENCES inventory_item(id)
```

---

## Recommended Indexes

```text
idx_inventory_movement_item

idx_inventory_movement_warehouse

idx_inventory_movement_type

idx_inventory_movement_reference

idx_inventory_movement_time
```

---

# Table — stock_transfer

## Purpose

Records inventory transfers between warehouses.

Transfers SHALL generate two inventory movements:

- Source warehouse decrease
- Destination warehouse increase

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| source_warehouse_id | UUID |
| destination_warehouse_id | UUID |
| transfer_number | VARCHAR(40) |
| transfer_status | VARCHAR(30) |
| requested_by | UUID |
| approved_by | UUID |
| transferred_at | TIMESTAMPTZ |
| received_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Transfer Status

Supported values:

```text
draft

requested

approved

in_transit

received

cancelled
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

transfer_number

)
```

---

## Recommended Indexes

```text
idx_transfer_source

idx_transfer_destination

idx_transfer_status

idx_transfer_number
```

---

# Table — stock_transfer_line

## Purpose

Defines individual inventory items included in a warehouse transfer.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| transfer_id | UUID |
| inventory_item_id | UUID |
| quantity | inventory_quantity |
| unit_cost | money_amount |

---

## Check Constraint

```sql
CHECK (

quantity > 0

)
```

---

## Foreign Keys

```sql
transfer_id
REFERENCES stock_transfer(id)
```

```sql
inventory_item_id
REFERENCES inventory_item(id)
```

---

# Table — stock_adjustment

## Purpose

Records manual inventory corrections.

Examples:

- Damaged stock
- Counting differences
- Theft
- Expired inventory
- Administrative correction

Adjustments SHALL generate inventory movements.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| warehouse_id | UUID |
| adjustment_number | VARCHAR(40) |
| adjustment_reason | VARCHAR(100) |
| approved_by | UUID |
| adjustment_date | DATE |
| created_at | TIMESTAMPTZ |

---

## Recommended Indexes

```text
idx_stock_adjustment_warehouse

idx_stock_adjustment_reason
```

---

# Table — stock_count

## Purpose

Represents a physical inventory count (cycle count or full stock take).

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| warehouse_id | UUID |
| count_number | VARCHAR(40) |
| count_date | DATE |
| count_status | VARCHAR(30) |
| counted_by | UUID |
| approved_by | UUID |
| created_at | TIMESTAMPTZ |

---

## Count Status

Supported values:

```text
planned

in_progress

completed

approved

cancelled
```

---

# Table — stock_count_line

## Purpose

Stores counted quantities for individual inventory items.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| stock_count_id | UUID |
| inventory_item_id | UUID |
| system_quantity | inventory_quantity |
| counted_quantity | inventory_quantity |
| variance_quantity | inventory_quantity |
| variance_cost | money_amount |

---

## Business Rule

Approving a stock count SHALL automatically generate inventory adjustment movements for any approved variances.

---

# Inventory Balance Calculation

Current stock SHALL always equal:

```text
Opening Balance

+

Receipts

+

Production Output

+

Transfers In

-

Sales

-

Production Consumption

-

Transfers Out

±

Adjustments

=

Current Quantity
```

The system SHALL never maintain stock as an independently editable value.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
warehouse

inventory_item

inventory_movement

stock_transfer

stock_transfer_line

stock_adjustment

stock_count

stock_count_line
```

Inventory SHALL remain isolated by organization.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- warehouse
- inventory_item
- stock_transfer

Ledger-style tables (`inventory_movement`, `stock_count_line`) SHALL remain append-only and SHALL not require update triggers.

---

# Validation Checklist

The Inventory & Warehouse module SHALL verify:

- Warehouse ownership enforced.
- Warehouse codes unique.
- Inventory item references validated.
- Immutable inventory ledger implemented.
- Transfer workflow supported.
- Stock adjustments supported.
- Physical stock counts supported.
- Inventory balance derived from movements.
- RLS enabled.
- Timestamp triggers attached where applicable.

The Inventory module SHALL be completed before implementing Procurement, Purchasing, and Sales Transactions.

---

END OF CHUNK 9/42

Next:

Chunk 10/42 — Procurement & Purchasing Schema Implementation (Purchase Orders, Goods Receipts, Supplier Invoices, Purchase Returns, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 9/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
10/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 9/42

Status:
Continuation

========================================

# Procurement & Purchasing Schema Implementation

## Purpose

This section defines BakeFlow's procurement implementation.

The Procurement module manages the complete purchasing lifecycle from supplier ordering through inventory receipt and supplier invoicing.

The module SHALL support:

- Purchase Requisitions
- Purchase Orders
- Goods Receipts
- Supplier Invoices
- Purchase Returns
- Procurement Approval Workflow

Every procurement transaction SHALL be fully traceable.

---

# Entity Relationship Overview

```text
Supplier
      │
      ▼
Purchase Requisition
      │
      ▼
Purchase Order
      │
      ▼
Goods Receipt
      │
      ├──── Inventory Movements
      │
      ▼
Supplier Invoice
      │
      ▼
Accounts Payable
      │
      ▼
Payment
```

---

# Table — purchase_requisition

## Purpose

Represents an internal request to procure inventory.

Purchase Requisitions SHALL precede Purchase Orders where approval workflows are enabled.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| branch_id | UUID | No | — |
| requisition_number | VARCHAR(40) | No | — |
| requested_by | UUID | No | — |
| required_date | DATE | Yes | — |
| status | VARCHAR(30) | No | 'draft' |
| remarks | TEXT | Yes | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Status Values

```text
draft

submitted

approved

rejected

converted

cancelled
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

requisition_number

)
```

---

## Recommended Indexes

```text
idx_purchase_requisition_org

idx_purchase_requisition_branch

idx_purchase_requisition_status

idx_purchase_requisition_number
```

---

# Table — purchase_order

## Purpose

Represents an approved order issued to a supplier.

Purchase Orders SHALL become the authoritative purchasing document.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| branch_id | UUID |
| supplier_id | UUID |
| requisition_id | UUID |
| purchase_order_number | VARCHAR(40) |
| order_date | DATE |
| expected_delivery_date | DATE |
| status | VARCHAR(30) |
| subtotal | money_amount |
| tax_amount | money_amount |
| discount_amount | money_amount |
| total_amount | money_amount |
| approved_by | UUID |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Status Values

```text
draft

approved

sent

partially_received

received

cancelled

closed
```

---

## Foreign Keys

```sql
supplier_id
REFERENCES supplier(id)
```

```sql
requisition_id
REFERENCES purchase_requisition(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

purchase_order_number

)
```

---

## Recommended Indexes

```text
idx_purchase_order_supplier

idx_purchase_order_status

idx_purchase_order_date

idx_purchase_order_number
```

---

# Table — purchase_order_line

## Purpose

Stores individual items ordered from suppliers.

Each line SHALL reference either:

- Ingredient
- Packaging Material
- Inventory Product

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| purchase_order_id | UUID |
| inventory_item_id | UUID |
| description | TEXT |
| ordered_quantity | inventory_quantity |
| received_quantity | inventory_quantity |
| unit_cost | money_amount |
| line_total | money_amount |

---

## Check Constraints

```sql
CHECK (

ordered_quantity > 0

)
```

```sql
CHECK (

unit_cost >= 0

)
```

---

## Recommended Indexes

```text
idx_purchase_order_line_order

idx_purchase_order_line_inventory
```

---

# Table — goods_receipt

## Purpose

Represents physical receipt of supplier deliveries.

Approving a Goods Receipt SHALL generate inventory receipt movements.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| warehouse_id | UUID |
| purchase_order_id | UUID |
| receipt_number | VARCHAR(40) |
| supplier_delivery_note | VARCHAR(100) |
| received_by | UUID |
| received_at | TIMESTAMPTZ |
| status | VARCHAR(30) |
| remarks | TEXT |
| created_at | TIMESTAMPTZ |

---

## Status Values

```text
draft

received

approved

rejected
```

---

## Business Rules

Only approved Goods Receipts SHALL update inventory.

Partial receipts SHALL remain supported.

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

receipt_number

)
```

---

## Recommended Indexes

```text
idx_goods_receipt_order

idx_goods_receipt_status

idx_goods_receipt_date
```

---

# Table — goods_receipt_line

## Purpose

Stores actual quantities received.

Supports partial deliveries.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| goods_receipt_id | UUID |
| purchase_order_line_id | UUID |
| quantity_received | inventory_quantity |
| accepted_quantity | inventory_quantity |
| rejected_quantity | inventory_quantity |
| unit_cost | money_amount |

---

## Business Rule

```text
accepted_quantity

+

rejected_quantity

=

quantity_received
```

---

## Check Constraint

```sql
CHECK (

quantity_received >= 0

)
```

---

# Table — supplier_invoice

## Purpose

Represents invoices received from suppliers.

Supplier invoices SHALL create Accounts Payable obligations.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| supplier_id | UUID |
| purchase_order_id | UUID |
| invoice_number | VARCHAR(60) |
| invoice_date | DATE |
| due_date | DATE |
| subtotal | money_amount |
| tax_amount | money_amount |
| total_amount | money_amount |
| payment_status | payment_status_enum |
| created_at | TIMESTAMPTZ |

---

## Unique Constraint

```sql
UNIQUE (

supplier_id,

invoice_number

)
```

Supplier invoice numbers SHALL be unique per supplier.

---

## Recommended Indexes

```text
idx_supplier_invoice_supplier

idx_supplier_invoice_due

idx_supplier_invoice_status
```

---

# Table — purchase_return

## Purpose

Represents inventory returned to suppliers.

Purchase returns SHALL:

- Reduce inventory.
- Reverse inventory valuation.
- Reduce supplier liability where applicable.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| supplier_id | UUID |
| goods_receipt_id | UUID |
| return_number | VARCHAR(40) |
| return_reason | VARCHAR(100) |
| returned_by | UUID |
| return_date | DATE |
| created_at | TIMESTAMPTZ |

---

## Recommended Return Reasons

```text
Damaged

Expired

Wrong Item

Over Delivery

Quality Failure

Supplier Error
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

return_number

)
```

---

# Inventory Integration

Approving a Goods Receipt SHALL create:

```text
Inventory Receipt

↓

Increase Stock

↓

Update Inventory Ledger
```

Approving a Purchase Return SHALL create:

```text
Inventory Return

↓

Decrease Stock

↓

Update Inventory Ledger
```

Inventory SHALL never be updated directly.

---

# Financial Integration

Approving a Supplier Invoice SHALL generate:

```text
Debit

Inventory / Expense

Credit

Accounts Payable
```

Accounting implementation is defined within the Finance section.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
purchase_requisition

purchase_order

purchase_order_line

goods_receipt

goods_receipt_line

supplier_invoice

purchase_return
```

Procurement data SHALL remain isolated by organization.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- purchase_requisition
- purchase_order
- goods_receipt

Transactional history tables SHALL remain immutable after approval.

---

# Validation Checklist

The Procurement module SHALL verify:

- Supplier relationships enforced.
- Purchase Order numbering unique.
- Partial receipts supported.
- Inventory movements generated.
- Supplier invoices linked.
- Purchase returns supported.
- Financial integration ready.
- RLS enabled.
- Timestamp triggers attached.

The Procurement module SHALL be completed before implementing Sales, Quotations, Orders, and Customer Invoicing.

---

END OF CHUNK 10/42

Next:

Chunk 11/42 — Sales, Quotations & Order Management Schema Implementation (Quotations, Sales Orders, Order Lines, Fulfilment, Delivery Tracking, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 10/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
11/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 10/42

Status:
Continuation

========================================

# Sales, Quotations & Order Management Schema Implementation

## Purpose

This section defines the implementation of BakeFlow's sales pipeline.

The Sales module manages the complete customer order lifecycle from quotation through fulfilment and delivery.

The module SHALL support:

- Quotations
- Sales Orders
- Order Lines
- Order Status Tracking
- Order Fulfilment
- Delivery Assignment
- Customer Reservations
- Partial Deliveries

Sales transactions SHALL integrate directly with Inventory and Finance.

---

# Entity Relationship Overview

```text
Customer
      │
      ▼
Quotation
      │
      ▼
Sales Order
      │
      ├──── Order Line
      │
      ├──── Fulfilment
      │
      ├──── Delivery
      │
      └──── Invoice
```

---

# Table — quotation

## Purpose

Represents a non-binding price proposal issued to a customer.

Quotations MAY be converted into Sales Orders.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| branch_id | UUID | No | — |
| customer_id | UUID | No | — |
| quotation_number | VARCHAR(40) | No | — |
| quotation_date | DATE | No | CURRENT_DATE |
| valid_until | DATE | Yes | — |
| status | VARCHAR(30) | No | 'draft' |
| subtotal | money_amount | No | 0 |
| discount_amount | money_amount | No | 0 |
| tax_amount | money_amount | No | 0 |
| total_amount | money_amount | No | 0 |
| notes | TEXT | Yes | — |
| created_by | UUID | No | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Status Values

```text
draft

sent

accepted

expired

rejected

cancelled
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

quotation_number

)
```

---

## Recommended Indexes

```text
idx_quotation_org

idx_quotation_customer

idx_quotation_status

idx_quotation_date
```

---

# Table — quotation_line

## Purpose

Stores products proposed within a quotation.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| quotation_id | UUID |
| product_id | UUID |
| description | TEXT |
| quantity | inventory_quantity |
| unit_price | money_amount |
| discount_amount | money_amount |
| tax_amount | money_amount |
| line_total | money_amount |

---

## Check Constraints

```sql
CHECK (

quantity > 0

)
```

```sql
CHECK (

unit_price >= 0

)
```

---

# Table — sales_order

## Purpose

Represents a confirmed customer order.

Sales Orders SHALL become the operational document used for:

- Production
- Reservation
- Delivery
- Invoicing

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| branch_id | UUID |
| customer_id | UUID |
| quotation_id | UUID |
| order_number | VARCHAR(40) |
| order_date | DATE |
| required_date | DATE |
| status | order_status_enum |
| subtotal | money_amount |
| discount_amount | money_amount |
| tax_amount | money_amount |
| total_amount | money_amount |
| special_instructions | TEXT |
| created_by | UUID |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Status Lifecycle

```text
draft

confirmed

processing

ready

delivered

cancelled
```

---

## Foreign Keys

```sql
customer_id
REFERENCES customer(id)
```

```sql
quotation_id
REFERENCES quotation(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

order_number

)
```

---

## Recommended Indexes

```text
idx_sales_order_customer

idx_sales_order_status

idx_sales_order_required

idx_sales_order_number
```

---

# Table — sales_order_line

## Purpose

Defines products ordered by the customer.

Selling prices SHALL be copied from the Product Price table at the time the order is confirmed.

Future price changes SHALL NOT modify existing orders.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| sales_order_id | UUID |
| product_id | UUID |
| quantity_ordered | inventory_quantity |
| quantity_reserved | inventory_quantity |
| quantity_fulfilled | inventory_quantity |
| unit_price | money_amount |
| discount_amount | money_amount |
| tax_amount | money_amount |
| line_total | money_amount |

---

## Check Constraints

```sql
CHECK (

quantity_ordered > 0

)
```

```sql
CHECK (

quantity_reserved >= 0

)
```

```sql
CHECK (

quantity_fulfilled >= 0

)
```

---

## Recommended Indexes

```text
idx_sales_order_line_order

idx_sales_order_line_product
```

---

# Table — order_fulfilment

## Purpose

Tracks fulfilment of customer orders.

Supports:

- Full fulfilment
- Partial fulfilment
- Multi-batch fulfilment

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| sales_order_line_id | UUID |
| production_batch_id | UUID |
| inventory_item_id | UUID |
| fulfilled_quantity | inventory_quantity |
| fulfilled_at | TIMESTAMPTZ |
| fulfilled_by | UUID |

---

## Business Rules

Multiple fulfilment records MAY exist for a single order line.

Total fulfilled quantity SHALL NOT exceed ordered quantity.

---

# Table — delivery

## Purpose

Represents physical delivery of a customer order.

Delivery SHALL remain optional.

Walk-in customers MAY complete orders without delivery records.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| branch_id | UUID |
| sales_order_id | UUID |
| delivery_number | VARCHAR(40) |
| delivery_status | VARCHAR(30) |
| delivery_address | TEXT |
| scheduled_delivery | TIMESTAMPTZ |
| actual_delivery | TIMESTAMPTZ |
| driver_employee_id | UUID |
| customer_signature | TEXT |
| remarks | TEXT |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Delivery Status

```text
scheduled

assigned

out_for_delivery

delivered

failed

cancelled
```

---

## Foreign Keys

```sql
sales_order_id
REFERENCES sales_order(id)
```

```sql
driver_employee_id
REFERENCES employee(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

delivery_number

)
```

---

## Recommended Indexes

```text
idx_delivery_order

idx_delivery_driver

idx_delivery_status

idx_delivery_schedule
```

---

# Inventory Reservation

Confirming a Sales Order MAY reserve inventory.

Reservation SHALL:

- Reduce available stock.
- Not reduce physical stock.

Physical inventory SHALL decrease only upon fulfilment or invoicing, depending on the organization's inventory policy.

---

# Production Integration

Sales Orders MAY generate Production Requests when:

```text
Ordered Quantity

>

Available Inventory
```

Automatic production planning SHALL remain configurable.

---

# Delivery Integration

Deliveries SHALL support:

- Multiple deliveries per order.
- Partial deliveries.
- Driver assignment.
- Delivery confirmation.
- Customer acknowledgement.

Delivery records SHALL remain immutable after completion.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
quotation

quotation_line

sales_order

sales_order_line

order_fulfilment

delivery
```

Users SHALL only access records belonging to their organization.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- quotation
- sales_order
- delivery

Order fulfilment records SHALL remain append-only.

---

# Validation Checklist

The Sales module SHALL verify:

- Customer relationships enforced.
- Quotation conversion supported.
- Sales Order numbering unique.
- Price snapshots preserved.
- Partial fulfilment supported.
- Delivery workflow supported.
- Inventory reservation supported.
- Production integration ready.
- RLS enabled.
- Timestamp triggers attached.

The Sales module SHALL be completed before implementing Customer Invoicing, Payments, and Financial Posting.

---

END OF CHUNK 11/42

Next:

Chunk 12/42 — Customer Invoicing & Payment Schema Implementation (Invoices, Invoice Lines, Receipts, Customer Payments, Credit Notes, Allocations, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 11/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
12/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 11/42

Status:
Continuation

========================================

# Customer Invoicing & Payment Schema Implementation

## Purpose

This section defines BakeFlow's Accounts Receivable implementation.

The module manages the complete customer billing lifecycle including:

- Customer Invoices
- Invoice Lines
- Customer Payments
- Receipts
- Credit Notes
- Payment Allocations
- Outstanding Balances

Customer billing SHALL integrate directly with the General Ledger.

---

# Entity Relationship Overview

```text
Sales Order
      │
      ▼
Customer Invoice
      │
      ├──── Invoice Line
      │
      ├──── Payment Allocation
      │
      ├──── Credit Note
      │
      └──── Customer Payment
                    │
                    ▼
                 Receipt
```

---

# Table — customer_invoice

## Purpose

Represents an official financial document issued to a customer.

Invoices SHALL become immutable after posting.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| branch_id | UUID | No | — |
| customer_id | UUID | No | — |
| sales_order_id | UUID | Yes | — |
| invoice_number | VARCHAR(40) | No | — |
| invoice_date | DATE | No | CURRENT_DATE |
| due_date | DATE | Yes | — |
| status | invoice_status_enum | No | 'draft' |
| subtotal | money_amount | No | 0 |
| discount_amount | money_amount | No | 0 |
| tax_amount | money_amount | No | 0 |
| total_amount | money_amount | No | 0 |
| balance_due | money_amount | No | 0 |
| posted_at | TIMESTAMPTZ | Yes | — |
| created_by | UUID | No | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Invoice Lifecycle

```text
draft

↓

issued

↓

paid

↓

overdue

↓

cancelled
```

Only `draft` invoices MAY be edited.

---

## Foreign Keys

```sql
customer_id
REFERENCES customer(id)
```

```sql
sales_order_id
REFERENCES sales_order(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

invoice_number

)
```

---

## Recommended Indexes

```text
idx_customer_invoice_customer

idx_customer_invoice_status

idx_customer_invoice_due

idx_customer_invoice_number
```

---

# Table — customer_invoice_line

## Purpose

Stores invoice line items.

Invoice lines SHALL preserve the product price at the time the invoice is issued.

Historical invoices SHALL never change.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| customer_invoice_id | UUID |
| product_id | UUID |
| description | TEXT |
| quantity | inventory_quantity |
| unit_price | money_amount |
| discount_amount | money_amount |
| tax_amount | money_amount |
| line_total | money_amount |

---

## Check Constraints

```sql
CHECK (

quantity > 0

)
```

```sql
CHECK (

unit_price >= 0

)
```

---

## Foreign Keys

```sql
customer_invoice_id
REFERENCES customer_invoice(id)
```

```sql
product_id
REFERENCES product(id)
```

---

# Table — customer_payment

## Purpose

Represents money received from customers.

Payments MAY settle one or multiple invoices.

Overpayments SHALL be supported.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| customer_id | UUID |
| payment_reference | VARCHAR(60) |
| payment_date | DATE |
| payment_method | VARCHAR(30) |
| amount_received | money_amount |
| currency_code | CHAR(3) |
| exchange_rate | NUMERIC(18,6) |
| bank_reference | VARCHAR(100) |
| received_by | UUID |
| notes | TEXT |
| created_at | TIMESTAMPTZ |

---

## Payment Methods

Supported values:

```text
cash

bank_transfer

card

mobile_money

cheque

credit
```

Future payment methods MAY be introduced through configuration.

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

payment_reference

)
```

---

## Recommended Indexes

```text
idx_customer_payment_customer

idx_customer_payment_date

idx_customer_payment_reference
```

---

# Table — payment_allocation

## Purpose

Allocates customer payments to one or more invoices.

Supports:

- Partial payments
- Multiple invoices
- Overpayments
- Advance payments

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| customer_payment_id | UUID |
| customer_invoice_id | UUID |
| allocated_amount | money_amount |
| allocated_at | TIMESTAMPTZ |
| allocated_by | UUID |

---

## Business Rules

The sum of all allocations SHALL NOT exceed the payment amount.

Invoice balances SHALL be updated automatically.

---

## Foreign Keys

```sql
customer_payment_id
REFERENCES customer_payment(id)
```

```sql
customer_invoice_id
REFERENCES customer_invoice(id)
```

---

## Recommended Indexes

```text
idx_payment_allocation_payment

idx_payment_allocation_invoice
```

---

# Table — receipt

## Purpose

Represents the official acknowledgement of payment received.

Each customer payment SHALL generate exactly one receipt.

Receipts SHALL remain immutable.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| customer_payment_id | UUID |
| receipt_number | VARCHAR(40) |
| receipt_date | DATE |
| issued_by | UUID |
| created_at | TIMESTAMPTZ |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

receipt_number

)
```

---

## Recommended Indexes

```text
idx_receipt_payment

idx_receipt_number
```

---

# Table — credit_note

## Purpose

Represents reductions to customer invoices.

Credit Notes SHALL support:

- Returned Goods
- Pricing Errors
- Customer Discounts
- Invoice Corrections

Credit Notes SHALL never modify the original invoice.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| customer_invoice_id | UUID |
| credit_note_number | VARCHAR(40) |
| credit_reason | VARCHAR(100) |
| credit_amount | money_amount |
| approved_by | UUID |
| issued_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Recommended Credit Reasons

```text
Product Return

Pricing Error

Damaged Goods

Commercial Discount

Administrative Correction
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

credit_note_number

)
```

---

# Invoice Posting Rules

Posting an invoice SHALL:

```text
Create Accounts Receivable

↓

Generate Journal Entry

↓

Reserve Financial History

↓

Prevent Further Editing
```

Invoices SHALL remain immutable after posting.

---

# Payment Processing Rules

Recording a customer payment SHALL:

```text
Create Receipt

↓

Generate Journal Entry

↓

Allocate to Invoice(s)

↓

Update Customer Balance
```

Payments SHALL remain fully auditable.

---

# Outstanding Balance Calculation

Outstanding balance SHALL equal:

```text
Invoice Total

-

Allocated Payments

-

Credit Notes

=

Balance Due
```

Balances SHALL be calculated from transactions rather than maintained manually.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
customer_invoice

customer_invoice_line

customer_payment

payment_allocation

receipt

credit_note
```

Customer financial information SHALL remain isolated by organization.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- customer_invoice

Posted accounting documents (`customer_payment`, `receipt`, `credit_note`) SHALL remain immutable and SHALL not require update triggers.

---

# Validation Checklist

The Customer Invoicing & Payment module SHALL verify:

- Invoice numbering unique.
- Price snapshots preserved.
- Immutable posted invoices.
- Multiple invoice allocations supported.
- Partial payments supported.
- Receipts generated.
- Credit notes supported.
- Outstanding balances calculated.
- Financial posting ready.
- RLS enabled.

The Customer Invoicing & Payment module SHALL be completed before implementing the General Ledger and Accounting Engine.

---

END OF CHUNK 12/42

Next:

Chunk 13/42 — Financial Foundation Schema Implementation (Chart of Accounts, Fiscal Periods, Cost Centers, Dimensions, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 12/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
13/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 12/42

Status:
Continuation

========================================

# Financial Foundation Schema Implementation

## Purpose

This section defines the foundational accounting structures required by BakeFlow.

These tables provide the basis for every financial transaction recorded throughout the platform.

The Financial Foundation SHALL support:

- Multi-level Chart of Accounts
- Fiscal Years
- Accounting Periods
- Cost Centers
- Financial Dimensions
- Posting Controls
- Account Classification

Every financial transaction SHALL reference this foundation.

---

# Entity Relationship Overview

```text
Organization
        │
        ├──────── Fiscal Year
        │             │
        │             ▼
        │      Accounting Period
        │
        ├──────── Chart of Accounts
        │             │
        │             ▼
        │      Journal Entries
        │
        ├──────── Cost Center
        │
        └──────── Financial Dimension
```

---

# Table — fiscal_year

## Purpose

Represents an accounting year.

Fiscal Years SHALL define the highest accounting period boundary.

Example:

```text
2026 Fiscal Year

01-Jan-2026

↓

31-Dec-2026
```

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| fiscal_year_name | VARCHAR(50) | No | — |
| start_date | DATE | No | — |
| end_date | DATE | No | — |
| is_closed | BOOLEAN | No | FALSE |
| closed_at | TIMESTAMPTZ | Yes | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Business Rules

Fiscal years SHALL NOT overlap.

Only one fiscal year MAY be active at a time.

---

## Check Constraint

```sql
CHECK (

start_date < end_date

)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

fiscal_year_name

)
```

---

## Recommended Indexes

```text
idx_fiscal_year_org

idx_fiscal_year_active

idx_fiscal_year_closed
```

---

# Table — accounting_period

## Purpose

Represents posting periods within a fiscal year.

Most organizations SHALL use monthly periods.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| fiscal_year_id | UUID |
| period_number | SMALLINT |
| period_name | VARCHAR(50) |
| start_date | DATE |
| end_date | DATE |
| is_closed | BOOLEAN |
| closed_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Example

```text
January

↓

Period 1

↓

01-Jan

↓

31-Jan
```

---

## Business Rules

Journal entries SHALL only post into open accounting periods.

Closed periods SHALL reject new postings.

---

## Unique Constraint

```sql
UNIQUE (

fiscal_year_id,

period_number

)
```

---

## Recommended Indexes

```text
idx_accounting_period_year

idx_accounting_period_closed
```

---

# Table — account

## Purpose

Represents the organization's Chart of Accounts.

Every financial transaction SHALL reference one or more accounts.

The Chart of Accounts SHALL remain organization-specific.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| parent_account_id | UUID | Yes | — |
| account_code | VARCHAR(20) | No | — |
| account_name | VARCHAR(150) | No | — |
| account_type | VARCHAR(30) | No | — |
| account_category | VARCHAR(50) | No | — |
| normal_balance | CHAR(1) | No | — |
| allow_manual_posting | BOOLEAN | No | TRUE |
| is_control_account | BOOLEAN | No | FALSE |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Supported Account Types

```text
asset

liability

equity

revenue

expense
```

---

## Example Categories

```text
Current Assets

Fixed Assets

Current Liabilities

Long-Term Liabilities

Sales Revenue

Operating Expenses

Cost of Sales

Equity
```

---

## Normal Balance

Supported values:

```text
D

Debit

C

Credit
```

---

## Foreign Keys

```sql
tenant_id
REFERENCES organization(id)
```

```sql
parent_account_id
REFERENCES account(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

account_code

)
```

---

## Recommended Indexes

```text
idx_account_org

idx_account_parent

idx_account_code

idx_account_type

idx_account_active
```

---

# Table — cost_center

## Purpose

Allows financial reporting by department or operational area.

Examples:

```text
Production

Retail

Administration

Delivery

Marketing
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| cost_center_code | VARCHAR(20) |
| cost_center_name | VARCHAR(100) |
| description | TEXT |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

cost_center_code

)
```

---

## Recommended Indexes

```text
idx_cost_center_org

idx_cost_center_code

idx_cost_center_active
```

---

# Table — financial_dimension

## Purpose

Provides additional reporting dimensions beyond Cost Centers.

Organizations MAY define custom reporting dimensions.

Examples:

```text
Project

Region

Business Unit

Product Line

Sales Channel
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| dimension_type | VARCHAR(50) |
| dimension_code | VARCHAR(30) |
| dimension_name | VARCHAR(100) |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

dimension_type,

dimension_code

)
```

---

## Recommended Indexes

```text
idx_dimension_org

idx_dimension_type

idx_dimension_code
```

---

# Default Chart of Accounts Structure

Recommended hierarchy:

```text
1000 Assets

2000 Liabilities

3000 Equity

4000 Revenue

5000 Cost of Sales

6000 Operating Expenses

7000 Other Income

8000 Other Expenses
```

Organizations MAY extend the hierarchy.

---

# Posting Rules

Accounts SHALL enforce:

- Account must be active.
- Accounting period must be open.
- Account type SHALL remain immutable after postings.
- Control accounts SHALL reject manual journals where configured.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
fiscal_year

accounting_period

account

cost_center

financial_dimension
```

Financial structures SHALL remain organization-owned.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- fiscal_year
- account
- cost_center
- financial_dimension

Accounting periods SHALL only update while open.

---

# Seed Data

System initialization SHOULD seed:

- Default Chart of Accounts
- Default Fiscal Year (optional)
- Standard Cost Centers (optional)

Seed data SHALL remain configurable during onboarding.

---

# Validation Checklist

The Financial Foundation module SHALL verify:

- Fiscal years unique.
- Accounting periods non-overlapping.
- Hierarchical Chart of Accounts supported.
- Account codes unique.
- Cost centers implemented.
- Financial dimensions implemented.
- Posting controls enforced.
- RLS enabled.
- Timestamp triggers attached.

The Financial Foundation SHALL be completed before implementing the General Ledger and Double-Entry Accounting Engine.

---

END OF CHUNK 13/42

Next:

Chunk 14/42 — General Ledger Schema Implementation (Journal Entries, Journal Lines, Posting Engine, Double-Entry Accounting, Reversals, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 13/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
14/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 13/42

Status:
Continuation

========================================

# General Ledger Schema Implementation

## Purpose

This section defines BakeFlow's double-entry accounting implementation.

The General Ledger SHALL serve as the single authoritative source of financial truth.

Every financial event generated anywhere in the system SHALL ultimately produce balanced journal entries.

Manual ledger modifications SHALL never be permitted.

---

# Entity Relationship Overview

```text
Accounting Period
        │
        ▼
Journal Entry
        │
        ├──────── Journal Line
        │
        ├──────── Cost Center
        │
        ├──────── Financial Dimension
        │
        └──────── Source Document
```

---

# Double-Entry Accounting Rule

Every journal SHALL satisfy:

```text
Total Debits

=

Total Credits
```

Unbalanced journals SHALL never be posted.

---

# Table — journal_entry

## Purpose

Represents a complete accounting transaction.

Examples:

- Customer Invoice
- Customer Payment
- Supplier Invoice
- Expense
- Inventory Adjustment
- Production Completion
- Payroll
- Manual Journal

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| accounting_period_id | UUID | No | — |
| journal_number | VARCHAR(40) | No | — |
| journal_date | DATE | No | CURRENT_DATE |
| journal_type | VARCHAR(40) | No | — |
| source_table | VARCHAR(50) | Yes | — |
| source_id | UUID | Yes | — |
| description | TEXT | Yes | — |
| status | journal_entry_status_enum | No | 'draft' |
| posted_at | TIMESTAMPTZ | Yes | — |
| posted_by | UUID | Yes | — |
| reversal_of_journal_id | UUID | Yes | — |
| created_by | UUID | No | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Journal Status

Supported values:

```text
draft

posted

reversed
```

Only `draft` journals MAY be edited.

---

## Journal Types

Examples:

```text
sales_invoice

customer_payment

supplier_invoice

supplier_payment

inventory

production

expense

payroll

manual

adjustment

opening_balance
```

Additional types MAY be introduced.

---

## Foreign Keys

```sql
tenant_id
REFERENCES organization(id)
```

```sql
accounting_period_id
REFERENCES accounting_period(id)
```

```sql
reversal_of_journal_id
REFERENCES journal_entry(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

journal_number

)
```

---

## Recommended Indexes

```text
idx_journal_org

idx_journal_period

idx_journal_date

idx_journal_status

idx_journal_source

idx_journal_number
```

---

# Table — journal_line

## Purpose

Stores the debit and credit postings belonging to a journal.

Each journal SHALL contain a minimum of two journal lines.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| journal_entry_id | UUID |
| account_id | UUID |
| cost_center_id | UUID |
| financial_dimension_id | UUID |
| line_number | SMALLINT |
| description | TEXT |
| debit_amount | money_amount |
| credit_amount | money_amount |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Each line SHALL contain either:

```text
Debit

OR

Credit
```

Both SHALL NOT be greater than zero simultaneously.

---

## Check Constraint

```sql
CHECK (

(debit_amount > 0 AND credit_amount = 0)

OR

(credit_amount > 0 AND debit_amount = 0)

)
```

---

## Foreign Keys

```sql
journal_entry_id
REFERENCES journal_entry(id)
```

```sql
account_id
REFERENCES account(id)
```

```sql
cost_center_id
REFERENCES cost_center(id)
```

```sql
financial_dimension_id
REFERENCES financial_dimension(id)
```

---

## Recommended Indexes

```text
idx_journal_line_journal

idx_journal_line_account

idx_journal_line_cost_center

idx_journal_line_dimension
```

---

# Posting Engine Rules

A journal SHALL only post when:

- Accounting period is open.
- Organization is active.
- Journal status is `draft`.
- Total Debits equal Total Credits.
- Every referenced account is active.
- Every account permits posting.

Failure of any rule SHALL prevent posting.

---

# Source Document Traceability

Each journal MAY reference:

```text
source_table

+

source_id
```

Examples:

```text
customer_invoice

supplier_invoice

expense

production_batch

inventory_adjustment

customer_payment
```

Every automatic journal SHALL remain traceable to its originating transaction.

---

# Reversal Journals

Corrections SHALL use reversal journals.

Original journals SHALL never be modified.

A reversal SHALL:

- Copy every journal line.
- Reverse debit and credit amounts.
- Link to the original journal.

Audit history SHALL remain intact.

---

# Ledger Integrity Rules

The following SHALL remain prohibited:

- Deleting posted journals.
- Updating posted journal lines.
- Changing posted account references.
- Editing posted amounts.

Corrections SHALL always use new journal entries.

---

# Cost Center Allocation

Journal lines MAY reference a Cost Center.

Examples:

```text
Production

Retail

Administration

Delivery
```

Financial reports SHALL support Cost Center filtering.

---

# Financial Dimensions

Journal lines MAY additionally reference one Financial Dimension.

Example:

```text
Sales Channel

Region

Project

Business Unit
```

Dimensions SHALL remain optional.

---

# Automatic Posting Events

The following transactions SHALL automatically generate journals:

```text
Customer Invoice

Customer Payment

Supplier Invoice

Supplier Payment

Inventory Adjustment

Production Completion

Expense Approval

Payroll Posting

Opening Balance

Year-End Closing
```

Manual journal creation SHALL remain available to authorized users.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
journal_entry

journal_line
```

Journal visibility SHALL remain organization-specific.

---

# Trigger Requirements

Timestamp update triggers SHALL attach only to:

- journal_entry (while in draft status)

Posted journals and journal lines SHALL remain immutable.

---

# Audit Requirements

Every journal SHALL record:

- Creation Time
- Creator
- Posting Time
- Posted By
- Source Document
- Accounting Period
- Reversal Reference (if applicable)

Audit information SHALL remain permanently available.

---

# Validation Checklist

The General Ledger module SHALL verify:

- Journal numbering unique.
- Double-entry enforcement.
- Balanced journals required.
- Posting period validation.
- Immutable posted journals.
- Source document traceability.
- Reversal support implemented.
- Cost Center allocation supported.
- Financial Dimensions supported.
- RLS enabled.

The General Ledger SHALL be completed before implementing Fixed Assets, Budgeting, and Financial Reporting.

---

END OF CHUNK 14/42

Next:

Chunk 15/42 — Expense, Cash Management & Banking Schema Implementation (Expenses, Petty Cash, Bank Accounts, Bank Transactions, Cash Reconciliation, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 14/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
15/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 14/42

Status:
Continuation

========================================

# Expense, Cash Management & Banking Schema Implementation

## Purpose

This section defines BakeFlow's operational finance implementation.

The module manages day-to-day financial transactions including:

- Expense Recording
- Expense Approval
- Petty Cash
- Cash Registers
- Bank Accounts
- Bank Transactions
- Cash Transfers
- Bank Reconciliation

Every approved transaction SHALL generate General Ledger postings.

---

# Entity Relationship Overview

```text
Expense Category
        │
        ▼
Expense
        │
        ├──── Expense Approval
        │
        ├──── Journal Entry
        │
        ▼
Payment
                │
                ├──── Cash Register
                │
                ├──── Petty Cash
                │
                └──── Bank Account
```

---

# Table — expense_category

## Purpose

Classifies operational expenses.

Examples include:

```text
Utilities

Fuel

Maintenance

Office Supplies

Packaging

Transportation

Cleaning

Marketing

Repairs
```

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| account_id | UUID | No | — |
| category_code | VARCHAR(30) | No | — |
| category_name | VARCHAR(100) | No | — |
| description | TEXT | Yes | — |
| requires_approval | BOOLEAN | No | TRUE |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Foreign Keys

```sql
account_id
REFERENCES account(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

category_code

)
```

---

## Recommended Indexes

```text
idx_expense_category_org

idx_expense_category_account

idx_expense_category_active
```

---

# Table — expense

## Purpose

Represents an operational expense.

Expenses SHALL remain editable only until approved.

Approval SHALL generate accounting entries.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| branch_id | UUID |
| expense_category_id | UUID |
| cost_center_id | UUID |
| expense_number | VARCHAR(40) |
| expense_date | DATE |
| description | TEXT |
| vendor_name | VARCHAR(150) |
| amount | money_amount |
| payment_method | VARCHAR(30) |
| status | VARCHAR(30) |
| receipt_reference | VARCHAR(100) |
| approved_by | UUID |
| approved_at | TIMESTAMPTZ |
| created_by | UUID |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Status Values

```text
draft

submitted

approved

paid

cancelled
```

---

## Check Constraint

```sql
CHECK (

amount >= 0

)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

expense_number

)
```

---

## Recommended Indexes

```text
idx_expense_org

idx_expense_branch

idx_expense_status

idx_expense_date

idx_expense_category
```

---

# Table — cash_register

## Purpose

Represents physical cash locations.

Examples:

```text
Main Cash Drawer

Retail Cash

Production Cash

Delivery Cash
```

Each branch MAY operate multiple cash registers.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| branch_id | UUID |
| account_id | UUID |
| register_code | VARCHAR(30) |
| register_name | VARCHAR(100) |
| opening_balance | money_amount |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Foreign Keys

```sql
account_id
REFERENCES account(id)
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

register_code

)
```

---

# Table — petty_cash_fund

## Purpose

Represents controlled petty cash funds.

Each petty cash fund SHALL reconcile independently.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| branch_id | UUID |
| account_id | UUID |
| fund_name | VARCHAR(100) |
| custodian_employee_id | UUID |
| imprest_amount | money_amount |
| current_balance | money_amount |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Business Rules

Current balance SHALL be system-calculated.

Manual balance updates SHALL not be permitted.

---

## Recommended Indexes

```text
idx_petty_cash_branch

idx_petty_cash_employee
```

---

# Table — bank_account

## Purpose

Represents company bank accounts.

Each bank account SHALL correspond to one General Ledger account.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| account_id | UUID |
| bank_name | VARCHAR(150) |
| account_name | VARCHAR(150) |
| account_number | VARCHAR(50) |
| currency_code | CHAR(3) |
| opening_balance | money_amount |
| is_primary | BOOLEAN |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Foreign Keys

```sql
account_id
REFERENCES account(id)
```

---

## Recommended Indexes

```text
idx_bank_account_org

idx_bank_account_number

idx_bank_account_active
```

---

# Table — bank_transaction

## Purpose

Stores bank account activity.

Transactions MAY originate from:

- Customer Payments
- Supplier Payments
- Transfers
- Deposits
- Withdrawals
- Bank Charges
- Interest

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| bank_account_id | UUID |
| transaction_date | DATE |
| transaction_reference | VARCHAR(100) |
| description | TEXT |
| debit_amount | money_amount |
| credit_amount | money_amount |
| running_balance | money_amount |
| source_table | VARCHAR(50) |
| source_id | UUID |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Bank transactions SHALL be append-only.

Running balances SHALL be system-generated.

---

## Recommended Indexes

```text
idx_bank_transaction_account

idx_bank_transaction_date

idx_bank_transaction_reference
```

---

# Table — bank_reconciliation

## Purpose

Tracks reconciliation between recorded bank transactions and bank statements.

Supports monthly reconciliation.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| bank_account_id | UUID |
| statement_date | DATE |
| statement_balance | money_amount |
| system_balance | money_amount |
| difference_amount | money_amount |
| reconciled_by | UUID |
| reconciled_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Reconciliations SHALL preserve historical snapshots.

Previously reconciled periods SHALL remain locked.

---

## Recommended Indexes

```text
idx_bank_reconciliation_account

idx_bank_reconciliation_date
```

---

# Cash Transfer Rules

Cash transfers SHALL support:

```text
Cash Register

↓

Bank

↓

Cash Register
```

and

```text
Bank

↓

Bank
```

Each transfer SHALL generate balanced journal entries.

---

# Expense Posting Rules

Approving an expense SHALL:

```text
Debit Expense Account

Credit Cash / Bank / Payable
```

Expense approval SHALL remain the financial posting trigger.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
expense_category

expense

cash_register

petty_cash_fund

bank_account

bank_transaction

bank_reconciliation
```

Financial operations SHALL remain organization-specific.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- expense_category
- expense
- cash_register
- petty_cash_fund
- bank_account

Bank transactions and reconciliations SHALL remain immutable after creation.

---

# Validation Checklist

The Expense & Cash Management module SHALL verify:

- Expense categories linked to accounts.
- Expense approval workflow implemented.
- Cash registers supported.
- Petty cash funds supported.
- Bank accounts linked to the Chart of Accounts.
- Bank transactions append-only.
- Bank reconciliation implemented.
- Automatic journal posting supported.
- RLS enabled.
- Timestamp triggers attached.

The Expense & Cash Management module SHALL be completed before implementing Payroll, Budgeting, Fixed Assets, and Financial Reporting.

---

END OF CHUNK 15/42

Next:

Chunk 16/42 — Payroll, Fixed Assets & Budgeting Schema Implementation (Payroll, Asset Register, Depreciation, Budgets, Budget Lines, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 15/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
16/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 15/42

Status:
Continuation

========================================

# Payroll, Fixed Assets & Budgeting Schema Implementation

## Purpose

This section defines the implementation of BakeFlow's Payroll, Fixed Asset, and Budgeting modules.

These modules support long-term financial management and strategic planning.

The implementation SHALL support:

- Payroll Processing
- Payroll Components
- Fixed Asset Register
- Depreciation
- Asset Disposal
- Operating Budgets
- Budget Revisions
- Budget vs Actual Analysis

Every approved financial event SHALL integrate with the General Ledger.

---

# Entity Relationship Overview

```text
Employee
      │
      ▼
Payroll Run
      │
      ├──── Payroll Line
      │
      ▼
Journal Entry


Fixed Asset
      │
      ├──── Depreciation
      │
      └──── Disposal


Budget
      │
      └──── Budget Line
```

---

# Table — payroll_run

## Purpose

Represents one payroll processing cycle.

Examples:

```text
January Payroll

February Payroll

Weekly Payroll
```

Payroll runs SHALL remain immutable after posting.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| payroll_number | VARCHAR(40) | No | — |
| payroll_period_start | DATE | No | — |
| payroll_period_end | DATE | No | — |
| payment_date | DATE | No | — |
| status | VARCHAR(30) | No | 'draft' |
| processed_by | UUID | Yes | — |
| processed_at | TIMESTAMPTZ | Yes | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Status Values

```text
draft

processing

approved

posted

cancelled
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

payroll_number

)
```

---

## Recommended Indexes

```text
idx_payroll_run_org

idx_payroll_run_period

idx_payroll_run_status

idx_payroll_run_number
```

---

# Table — payroll_line

## Purpose

Represents payroll calculations for an employee within a payroll run.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| payroll_run_id | UUID |
| employee_id | UUID |
| gross_salary | money_amount |
| total_allowances | money_amount |
| total_deductions | money_amount |
| employer_contributions | money_amount |
| net_salary | money_amount |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Net Salary SHALL equal:

```text
Gross Salary

+

Allowances

-

Deductions
```

Payroll calculations SHALL be reproducible.

---

## Foreign Keys

```sql
payroll_run_id
REFERENCES payroll_run(id)
```

```sql
employee_id
REFERENCES employee(id)
```

---

## Recommended Indexes

```text
idx_payroll_line_run

idx_payroll_line_employee
```

---

# Table — payroll_component

## Purpose

Defines reusable payroll elements.

Examples:

```text
Basic Salary

Housing Allowance

Transport Allowance

Overtime

Tax

Pension

Health Insurance

Loan Deduction
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| component_code | VARCHAR(30) |
| component_name | VARCHAR(100) |
| component_type | VARCHAR(20) |
| account_id | UUID |
| taxable | BOOLEAN |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Component Types

```text
earning

deduction

employer_contribution
```

---

## Recommended Indexes

```text
idx_payroll_component_org

idx_payroll_component_type
```

---

# Table — fixed_asset

## Purpose

Represents long-term business assets.

Examples:

```text
Industrial Oven

Delivery Van

Generator

Mixer

Computer

Furniture
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| asset_number | VARCHAR(40) |
| asset_name | VARCHAR(150) |
| asset_category | VARCHAR(100) |
| acquisition_date | DATE |
| acquisition_cost | money_amount |
| residual_value | money_amount |
| useful_life_months | INTEGER |
| depreciation_method | VARCHAR(30) |
| accumulated_depreciation | money_amount |
| carrying_amount | money_amount |
| status | VARCHAR(30) |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Depreciation Methods

Supported methods:

```text
straight_line

declining_balance

units_of_production
```

---

## Asset Status

```text
active

disposed

written_off
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

asset_number

)
```

---

## Recommended Indexes

```text
idx_fixed_asset_org

idx_fixed_asset_category

idx_fixed_asset_status
```

---

# Table — asset_depreciation

## Purpose

Stores depreciation history.

Each depreciation posting SHALL remain immutable.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| fixed_asset_id | UUID |
| accounting_period_id | UUID |
| depreciation_amount | money_amount |
| accumulated_depreciation | money_amount |
| carrying_amount | money_amount |
| journal_entry_id | UUID |
| posted_at | TIMESTAMPTZ |

---

## Business Rules

Only one depreciation record SHALL exist per asset per accounting period.

---

## Unique Constraint

```sql
UNIQUE (

fixed_asset_id,

accounting_period_id

)
```

---

## Recommended Indexes

```text
idx_asset_depreciation_asset

idx_asset_depreciation_period
```

---

# Table — asset_disposal

## Purpose

Represents disposal or sale of an asset.

Disposals SHALL generate:

- Gain/Loss calculations
- Journal Entries
- Asset status updates

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| fixed_asset_id | UUID |
| disposal_date | DATE |
| disposal_value | money_amount |
| disposal_reason | VARCHAR(100) |
| journal_entry_id | UUID |
| created_at | TIMESTAMPTZ |

---

## Disposal Reasons

```text
Sold

Scrapped

Lost

Donated

Destroyed
```

---

# Table — budget

## Purpose

Represents an approved financial budget.

Budgets SHALL support annual and periodic planning.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| fiscal_year_id | UUID |
| budget_name | VARCHAR(100) |
| version_number | INTEGER |
| status | VARCHAR(30) |
| approved_by | UUID |
| approved_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Budget Status

```text
draft

submitted

approved

archived
```

---

## Recommended Indexes

```text
idx_budget_org

idx_budget_year

idx_budget_status
```

---

# Table — budget_line

## Purpose

Stores planned financial values.

Budgets MAY be prepared by:

- Account
- Cost Center
- Financial Dimension

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| budget_id | UUID |
| account_id | UUID |
| cost_center_id | UUID |
| financial_dimension_id | UUID |
| accounting_period_id | UUID |
| budget_amount | money_amount |

---

## Business Rules

One budget SHALL contain one line per:

```text
Account

+

Period

+

Cost Center

+

Dimension
```

---

## Recommended Indexes

```text
idx_budget_line_budget

idx_budget_line_account

idx_budget_line_period
```

---

# Budget Variance

Variance SHALL calculate as:

```text
Actual

-

Budget

=

Variance
```

Variance percentages SHALL be calculated during reporting rather than stored.

---

# Financial Integration

The following SHALL automatically generate journal entries:

```text
Payroll Posting

Asset Acquisition

Asset Depreciation

Asset Disposal
```

Budget records SHALL not create financial postings.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
payroll_run

payroll_line

payroll_component

fixed_asset

asset_depreciation

asset_disposal

budget

budget_line
```

All records SHALL remain organization-owned.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- payroll_run
- payroll_component
- fixed_asset
- budget

Historical transaction tables SHALL remain immutable after posting.

---

# Validation Checklist

The Payroll, Fixed Asset & Budgeting module SHALL verify:

- Payroll runs uniquely identified.
- Payroll calculations reproducible.
- Payroll components configurable.
- Fixed Asset register implemented.
- Depreciation history immutable.
- Asset disposal supported.
- Budget versions supported.
- Budget variance reporting enabled.
- Financial integration implemented.
- RLS enabled.

The Payroll, Fixed Asset & Budgeting module SHALL be completed before implementing Financial Reporting, Dashboards, and Analytics.

---

END OF CHUNK 16/42

Next:

Chunk 17/42 — Financial Reporting & Analytics Schema Implementation (Trial Balance, General Ledger Views, Income Statement, Balance Sheet, Cash Flow, Materialized Views, Reporting Tables & RLS)

Append this chunk immediately below Chunk 16/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
17/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 16/42

Status:
Continuation

========================================

# Financial Reporting & Analytics Schema Implementation

## Purpose

This section defines BakeFlow's financial reporting architecture.

The reporting layer SHALL provide reliable financial statements directly from transactional data without requiring manual calculations.

The module SHALL support:

- Trial Balance
- General Ledger
- Income Statement
- Balance Sheet
- Cash Flow Statement
- Budget vs Actual
- Cost Center Reporting
- Financial Dimensions
- Materialized Reporting Views

Reporting SHALL always originate from posted journal entries.

---

# Reporting Architecture

```text
Operational Transactions

↓

Journal Entries

↓

Journal Lines

↓

Reporting Views

↓

Materialized Views

↓

Dashboards

↓

Financial Reports
```

The General Ledger SHALL remain the single source of financial truth.

---

# Reporting Principles

Financial reports SHALL:

- Read from posted journals only.
- Exclude draft journals.
- Support historical reporting.
- Support organization isolation.
- Support accounting period filtering.
- Support branch filtering where applicable.
- Support Cost Center analysis.
- Support Financial Dimension analysis.

Reports SHALL never modify transactional data.

---

# Reporting Schema

All reporting objects SHALL reside within:

```text
reporting
```

Materialized reporting views SHALL reside within:

```text
analytics
```

---

# View — vw_trial_balance

## Purpose

Provides account balances for a selected accounting period.

---

## Output Columns

| Column | Description |
|----------|-------------|
| account_code | GL Code |
| account_name | GL Name |
| account_type | Asset/Liability/etc. |
| opening_balance | Opening Balance |
| debit_total | Period Debits |
| credit_total | Period Credits |
| closing_balance | Ending Balance |

---

## Source Tables

```text
account

journal_entry

journal_line

accounting_period
```

---

## Business Rules

Only:

```text
Posted Journals
```

SHALL be included.

---

# View — vw_general_ledger

## Purpose

Provides detailed account transaction history.

---

## Output Columns

| Column | Description |
|----------|-------------|
| journal_date | Posting Date |
| journal_number | Journal Number |
| account_code | GL Account |
| description | Description |
| debit | Debit Amount |
| credit | Credit Amount |
| running_balance | Running Balance |

---

## Ordering

Records SHALL be sorted by:

```text
Journal Date

↓

Journal Number

↓

Journal Line
```

---

# View — vw_income_statement

## Purpose

Calculates Profit and Loss.

---

## Formula

```text
Revenue

-

Cost of Sales

=

Gross Profit

-

Operating Expenses

+

Other Income

-

Other Expenses

=

Net Profit
```

---

## Output Sections

```text
Revenue

Cost of Sales

Gross Profit

Operating Expenses

Operating Profit

Other Income

Other Expenses

Net Profit
```

---

# View — vw_balance_sheet

## Purpose

Calculates financial position.

---

## Formula

```text
Assets

=

Liabilities

+

Equity
```

---

## Sections

```text
Current Assets

Non-current Assets

Current Liabilities

Long-term Liabilities

Equity
```

---

# View — vw_cash_flow

## Purpose

Produces indirect-method cash flow reporting.

---

## Sections

```text
Operating Activities

Investing Activities

Financing Activities

Net Cash Movement
```

---

# View — vw_budget_variance

## Purpose

Compares Budget against Actual values.

---

## Output Columns

| Column | Description |
|----------|-------------|
| Account | GL Account |
| Budget | Planned |
| Actual | Posted |
| Variance | Difference |
| Variance % | Percentage |

---

## Formula

```text
Variance

=

Actual

-

Budget
```

---

# View — vw_cost_center_summary

## Purpose

Summarizes financial activity by Cost Center.

---

## Example

```text
Production

Revenue

Expenses

Profit
```

```text
Retail

Revenue

Expenses

Profit
```

---

# View — vw_dimension_summary

## Purpose

Summarizes activity using Financial Dimensions.

Examples:

```text
Sales Channel

Region

Business Unit

Project
```

---

# Materialized View — mv_daily_sales

## Purpose

Accelerates dashboard reporting.

---

## Refresh Schedule

Recommended:

```text
Hourly
```

or

```text
Every 15 Minutes
```

depending on deployment requirements.

---

## Source

```text
Sales Orders

Invoices

Payments
```

---

# Materialized View — mv_inventory_summary

## Purpose

Provides current inventory balances.

---

## Output

```text
Warehouse

Item

Available Quantity

Reserved Quantity

Reorder Status
```

---

# Materialized View — mv_profitability

## Purpose

Summarizes profitability.

Supports:

```text
Product

Category

Customer

Branch
```

---

# Materialized View — mv_financial_dashboard

## Purpose

Supports executive dashboards.

Typical metrics include:

- Revenue
- Expenses
- Gross Profit
- Net Profit
- Cash Balance
- Accounts Receivable
- Accounts Payable
- Inventory Value

---

# Reporting Performance

Large financial reports SHOULD utilize:

```sql
Materialized Views
```

instead of repeatedly scanning transactional tables.

---

# Refresh Strategy

Recommended refresh intervals:

| Object | Refresh |
|---------|----------|
| Daily Sales | Every 15 minutes |
| Inventory Summary | Every 5 minutes |
| Financial Dashboard | Hourly |
| Profitability | Hourly |

Organizations MAY customize refresh schedules.

---

# Recommended Reporting Indexes

Reporting views SHOULD leverage indexes on:

```text
Journal Date

Account

Accounting Period

Cost Center

Financial Dimension

Organization

Branch
```

---

# Row-Level Security

Reporting views SHALL inherit security from underlying tables.

Users SHALL never access financial reports outside their assigned organization.

Executive reporting MAY enforce additional permission checks.

---

# Report Export Support

Every report SHALL support export to:

```text
PDF

Excel (XLSX)

CSV
```

Generated reports SHALL preserve applied filters.

---

# Audit Requirements

Generated financial reports SHOULD record:

- Report Name
- Generated By
- Generation Time
- Applied Filters
- Accounting Period
- Export Format

Audit logging SHALL remain optional but recommended.

---

# Validation Checklist

The Reporting module SHALL verify:

- Trial Balance balances.
- Income Statement reconciles.
- Balance Sheet balances.
- Cash Flow generated.
- Budget comparison supported.
- Cost Center reporting supported.
- Financial Dimensions supported.
- Materialized views optimized.
- Reporting indexes implemented.
- RLS enforced.

The Financial Reporting module SHALL be completed before implementing Executive Dashboards, AI Analytics, and Business Intelligence.

---

END OF CHUNK 17/42

Next:

Chunk 18/42 — Dashboard, KPI & Business Intelligence Schema Implementation (Executive Dashboards, KPI Tables, Cached Metrics, Alert Thresholds, Analytics Pipeline, Constraints & RLS)

Append this chunk immediately below Chunk 17/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
18/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 17/42

Status:
Continuation

========================================

# Dashboard, KPI & Business Intelligence Schema Implementation

## Purpose

This section defines BakeFlow's Executive Dashboard and Business Intelligence architecture.

Unlike financial reports, dashboards SHALL provide near real-time operational visibility.

The Dashboard layer SHALL support:

- Executive KPIs
- Sales Dashboards
- Production Dashboards
- Inventory Dashboards
- Finance Dashboards
- Employee Performance
- Cached Metrics
- Alert Thresholds
- Analytics Pipeline

Dashboards SHALL prioritize performance over transactional detail.

---

# Dashboard Architecture

```text
Operational Tables

↓

Materialized Views

↓

Analytics Tables

↓

KPI Cache

↓

Dashboard APIs

↓

Mobile App

↓

Web Dashboard
```

Heavy analytical queries SHALL never execute directly against transactional tables.

---

# Analytics Schema

All dashboard objects SHALL reside within:

```text
analytics
```

---

# Table — kpi_definition

## Purpose

Defines every KPI available within BakeFlow.

KPIs SHALL be centrally managed.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | Yes | — |
| kpi_code | VARCHAR(50) | No | — |
| kpi_name | VARCHAR(150) | No | — |
| category | VARCHAR(50) | No | — |
| calculation_type | VARCHAR(30) | No | — |
| refresh_interval_minutes | INTEGER | No | 15 |
| is_system | BOOLEAN | No | TRUE |
| is_active | BOOLEAN | No | TRUE |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## KPI Categories

Supported values:

```text
Sales

Production

Inventory

Finance

Customers

Employees

Operations

Executive
```

---

## Unique Constraint

```sql
UNIQUE (

tenant_id,

kpi_code

)
```

System KPIs MAY use a NULL tenant_id.

---

## Recommended Indexes

```text
idx_kpi_definition_category

idx_kpi_definition_active

idx_kpi_definition_code
```

---

# Table — kpi_snapshot

## Purpose

Stores calculated KPI values.

Snapshots SHALL support historical trend analysis.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| branch_id | UUID |
| kpi_definition_id | UUID |
| snapshot_time | TIMESTAMPTZ |
| metric_value | NUMERIC(18,4) |
| metric_label | VARCHAR(100) |
| metadata | JSONB |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Snapshots SHALL be append-only.

Historical KPI values SHALL never be modified.

---

## Recommended Indexes

```text
idx_kpi_snapshot_kpi

idx_kpi_snapshot_time

idx_kpi_snapshot_branch
```

---

# Table — dashboard_cache

## Purpose

Caches expensive dashboard calculations.

The cache SHALL reduce repeated aggregation over large datasets.

---

## Columns

| Column | Type |
|---------|------|
| cache_key | VARCHAR(150) |
| tenant_id | UUID |
| branch_id | UUID |
| payload | JSONB |
| expires_at | TIMESTAMPTZ |
| refreshed_at | TIMESTAMPTZ |

---

## Business Rules

Expired cache entries SHALL automatically regenerate.

Applications SHALL never update cached payloads directly.

---

# Table — alert_rule

## Purpose

Defines KPI thresholds that generate operational alerts.

Examples:

```text
Low Inventory

Negative Cash Flow

High Waste

Production Delay

Outstanding Receivables

Low Gross Margin
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| kpi_definition_id | UUID |
| alert_name | VARCHAR(150) |
| comparison_operator | VARCHAR(10) |
| threshold_value | NUMERIC(18,4) |
| severity | VARCHAR(20) |
| notification_enabled | BOOLEAN |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Supported Operators

```text
>

<

>=

<=

=

!=
```

---

## Severity Levels

```text
info

warning

critical
```

---

## Recommended Indexes

```text
idx_alert_rule_kpi

idx_alert_rule_active

idx_alert_rule_severity
```

---

# Table — alert_event

## Purpose

Stores generated dashboard alerts.

Alerts SHALL remain historically traceable.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| alert_rule_id | UUID |
| detected_at | TIMESTAMPTZ |
| metric_value | NUMERIC(18,4) |
| status | VARCHAR(30) |
| acknowledged_by | UUID |
| acknowledged_at | TIMESTAMPTZ |
| resolved_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Alert Status

```text
new

acknowledged

resolved

dismissed
```

---

## Recommended Indexes

```text
idx_alert_event_status

idx_alert_event_detected

idx_alert_event_rule
```

---

# Executive Dashboard KPIs

Recommended executive metrics include:

```text
Today's Sales

Weekly Revenue

Monthly Revenue

Gross Profit

Net Profit

Cash Position

Accounts Receivable

Accounts Payable

Inventory Value

Production Efficiency

Waste Percentage

Customer Growth

Average Order Value
```

---

# Sales Dashboard KPIs

Recommended metrics:

```text
Orders Today

Revenue Today

Average Ticket Size

Top Customers

Top Products

Cancelled Orders

Outstanding Deliveries
```

---

# Production Dashboard KPIs

Recommended metrics:

```text
Today's Batches

Products Produced

Production Cost

Yield %

Waste %

Quality Pass Rate

Production Downtime
```

---

# Inventory Dashboard KPIs

Recommended metrics:

```text
Inventory Value

Low Stock Items

Out-of-Stock Items

Inventory Turnover

Slow Moving Inventory

Fast Moving Inventory
```

---

# Finance Dashboard KPIs

Recommended metrics:

```text
Cash Balance

Bank Balance

Outstanding Receivables

Outstanding Payables

Expenses Today

Profit Today

Operating Margin
```

---

# Cached Analytics Strategy

The following metrics SHOULD be cached:

```text
Sales Summary

Inventory Summary

Profitability

Receivables

Payables

Executive KPIs
```

Transaction detail SHALL never be cached permanently.

---

# Analytics Refresh Schedule

Recommended intervals:

| Dashboard | Refresh |
|-----------|----------|
| Sales | 5 minutes |
| Production | 5 minutes |
| Inventory | 5 minutes |
| Finance | 15 minutes |
| Executive | 15 minutes |
| KPIs | Configurable |

Organizations MAY customize refresh intervals.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
kpi_definition

kpi_snapshot

dashboard_cache

alert_rule

alert_event
```

System KPI definitions MAY remain globally readable.

Organization-specific KPI data SHALL remain isolated.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- kpi_definition
- alert_rule

Snapshot, cache, and alert event tables SHALL remain append-only where practical.

---

# Validation Checklist

The Dashboard & BI module SHALL verify:

- KPI definitions centralized.
- KPI snapshots historical.
- Dashboard caching implemented.
- Alert rules configurable.
- Alert history retained.
- Executive KPIs available.
- Department dashboards supported.
- Refresh scheduling implemented.
- RLS enabled.
- Analytics optimized.

The Dashboard & BI module SHALL be completed before implementing AI Services, Notifications, Integrations, and System Automation.

---

END OF CHUNK 18/42

Next:

Chunk 19/42 — Notification, Messaging & Communication Schema Implementation (Notifications, Email Queue, SMS Queue, Push Notifications, Templates, Delivery Logs, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 18/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
20/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 19/42

Status:
Continuation

========================================

# API Integration, Webhook & External Service Schema Implementation

## Purpose

This section defines BakeFlow's external integration architecture.

The Integration module SHALL enable secure communication with third-party services while maintaining complete auditability.

Supported integrations include:

- REST APIs
- Webhooks
- OAuth Providers
- Payment Gateways
- SMS Providers
- Email Providers
- Accounting Integrations
- ERP Integrations
- AI Services

Every external interaction SHALL be traceable.

---

# Integration Architecture

```text
Business Event

↓

Integration Event

↓

Job Queue

↓

API/Webhook

↓

External Service

↓

Response Handler

↓

Audit Log
```

Integration execution SHALL remain asynchronous wherever possible.

---

# Entity Relationship Overview

```text
API Key
      │
      ├──── Webhook
      │
      ├──── OAuth Connection
      │
      ├──── Integration Event
      │
      │
      ▼
Background Job
      │
      ▼
Execution Log
```

---

# Table — api_key

## Purpose

Stores API credentials issued for external applications.

Each key SHALL belong to exactly one organization.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | No | — |
| key_name | VARCHAR(100) | No | — |
| key_hash | TEXT | No | — |
| key_prefix | VARCHAR(20) | No | — |
| permissions | JSONB | No | '{}' |
| expires_at | TIMESTAMPTZ | Yes | — |
| last_used_at | TIMESTAMPTZ | Yes | — |
| is_active | BOOLEAN | No | TRUE |
| created_by | UUID | No | — |
| created_at | TIMESTAMPTZ | No | NOW() |
| updated_at | TIMESTAMPTZ | No | NOW() |

---

## Security Rules

Raw API keys SHALL NEVER be stored.

Only cryptographic hashes SHALL be persisted.

Example:

```text
bf_live_xxxxxxxxxxxxx

↓

SHA-256

↓

Stored Hash
```

---

## Recommended Indexes

```text
idx_api_key_org

idx_api_key_prefix

idx_api_key_active
```

---

# Table — webhook_endpoint

## Purpose

Represents outbound webhook destinations.

Examples:

```text
Shopify

QuickBooks

Slack

Zapier

Custom ERP
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| webhook_name | VARCHAR(100) |
| endpoint_url | TEXT |
| signing_secret | TEXT |
| subscribed_events | JSONB |
| retry_enabled | BOOLEAN |
| timeout_seconds | INTEGER |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Business Rules

Signing secrets SHALL remain encrypted.

HTTPS SHALL be mandatory.

---

## Recommended Indexes

```text
idx_webhook_org

idx_webhook_active
```

---

# Table — integration_event

## Purpose

Represents an event waiting to be delivered externally.

Examples:

```text
Invoice Created

Order Completed

Inventory Updated

Customer Created

Payment Received
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| event_type | VARCHAR(100) |
| source_table | VARCHAR(50) |
| source_id | UUID |
| payload | JSONB |
| event_time | TIMESTAMPTZ |
| status | VARCHAR(30) |
| retry_count | INTEGER |
| created_at | TIMESTAMPTZ |

---

## Event Status

```text
pending

processing

completed

failed

cancelled
```

---

## Recommended Indexes

```text
idx_integration_event_status

idx_integration_event_type

idx_integration_event_time
```

---

# Table — webhook_delivery

## Purpose

Stores every outbound webhook attempt.

Each retry SHALL generate a new delivery record.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| integration_event_id | UUID |
| webhook_endpoint_id | UUID |
| http_status | INTEGER |
| response_time_ms | INTEGER |
| request_headers | JSONB |
| response_headers | JSONB |
| response_body | JSONB |
| delivered_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Webhook history SHALL remain immutable.

---

## Recommended Indexes

```text
idx_webhook_delivery_event

idx_webhook_delivery_status
```

---

# Table — oauth_connection

## Purpose

Stores OAuth connections to external providers.

Examples:

```text
Google

Microsoft

Xero

QuickBooks

Stripe
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| provider | VARCHAR(50) |
| external_account_id | VARCHAR(150) |
| encrypted_access_token | BYTEA |
| encrypted_refresh_token | BYTEA |
| token_expires_at | TIMESTAMPTZ |
| scopes | JSONB |
| is_active | BOOLEAN |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

---

## Security Rules

OAuth tokens SHALL remain encrypted at rest.

Access tokens SHALL never appear in application logs.

---

## Recommended Indexes

```text
idx_oauth_provider

idx_oauth_active
```

---

# Table — background_job

## Purpose

Stores asynchronous work items.

Examples:

```text
Email Delivery

Inventory Rebuild

KPI Refresh

Webhook Delivery

AI Processing

Data Export
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| job_type | VARCHAR(100) |
| payload | JSONB |
| priority | SMALLINT |
| status | VARCHAR(30) |
| scheduled_at | TIMESTAMPTZ |
| started_at | TIMESTAMPTZ |
| completed_at | TIMESTAMPTZ |
| retry_count | INTEGER |
| created_at | TIMESTAMPTZ |

---

## Job Status

```text
queued

running

completed

failed

cancelled
```

---

## Priority Levels

```text
1

Critical

2

High

3

Normal

4

Low
```

---

## Recommended Indexes

```text
idx_background_job_status

idx_background_job_priority

idx_background_job_schedule
```

---

# Table — background_job_log

## Purpose

Stores execution history for background jobs.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| background_job_id | UUID |
| started_at | TIMESTAMPTZ |
| completed_at | TIMESTAMPTZ |
| execution_time_ms | INTEGER |
| result | VARCHAR(30) |
| error_message | TEXT |
| created_at | TIMESTAMPTZ |

---

## Result Values

```text
success

failure

retry
```

---

# Retry Strategy

Failed integrations SHALL retry using:

```text
1 Minute

↓

5 Minutes

↓

15 Minutes

↓

30 Minutes

↓

1 Hour

↓

6 Hours

↓

24 Hours
```

Retry schedules SHALL remain configurable.

---

# Integration Security

Every outbound request SHALL support:

- HTTPS only
- Request signing
- Timestamp validation
- Idempotency keys
- Rate limiting
- API versioning

---

# Audit Requirements

The system SHALL record:

- Request Timestamp
- Response Timestamp
- HTTP Status
- Execution Time
- Retry Count
- Source Event
- Organization
- Target Integration

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
api_key

webhook_endpoint

integration_event

oauth_connection

background_job
```

Execution log tables MAY be restricted to backend service roles.

---

# Trigger Requirements

Timestamp update triggers SHALL attach to:

- api_key
- webhook_endpoint
- oauth_connection

Execution history tables SHALL remain append-only.

---

# Validation Checklist

The Integration module SHALL verify:

- API keys securely hashed.
- HTTPS enforced.
- OAuth tokens encrypted.
- Webhook retry supported.
- Background job processing implemented.
- Event queue implemented.
- Execution logging complete.
- Integration audit trail retained.
- RLS enabled.
- Security policies enforced.

The Integration module SHALL be completed before implementing Audit Logging, Security Monitoring, Database Functions, and Migration Specifications.

---

END OF CHUNK 20/42

Next:

Chunk 21/42 — Audit Logging, Activity History & Compliance Schema Implementation (Audit Logs, Activity Timeline, Data Change History, Security Events, Compliance Records, Constraints, Indexes & RLS)

Append this chunk immediately below Chunk 20/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
21/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 20/42

Status:
Continuation

========================================

# Audit Logging, Activity History & Compliance Schema Implementation

## Purpose

This section defines BakeFlow's audit and compliance infrastructure.

Every significant business action SHALL be recorded in an immutable audit trail.

The audit subsystem SHALL support:

- Security Auditing
- Business Activity Tracking
- Database Change History
- User Activity Timeline
- Compliance Reporting
- Investigation Support
- Regulatory Retention
- Forensic Analysis

Audit records SHALL never be modified after creation.

---

# Audit Architecture

```text
User Action

↓

Business Operation

↓

Database Transaction

↓

Audit Event

↓

Activity Timeline

↓

Compliance Archive
```

Every audit event SHALL be attributable to an authenticated identity or trusted system process.

---

# Entity Relationship Overview

```text
User

↓

Activity Event

↓

Audit Log

↓

Change History

↓

Compliance Record
```

---

# Table — audit_log

## Purpose

Stores immutable records of every auditable system action.

---

## Columns

| Column | Type | Nullable | Default |
|---------|------|----------|----------|
| id | UUID | No | gen_random_uuid() |
| tenant_id | UUID | Yes | — |
| actor_user_id | UUID | Yes | — |
| actor_employee_id | UUID | Yes | — |
| event_type | VARCHAR(100) | No | — |
| entity_name | VARCHAR(100) | No | — |
| entity_id | UUID | Yes | — |
| operation | VARCHAR(20) | No | — |
| event_timestamp | TIMESTAMPTZ | No | NOW() |
| ip_address | INET | Yes | — |
| user_agent | TEXT | Yes | — |
| request_id | UUID | Yes | — |
| metadata | JSONB | No | '{}' |
| created_at | TIMESTAMPTZ | No | NOW() |

---

## Supported Operations

```text
create

update

delete

restore

login

logout

approve

reject

export

import

sync
```

---

## Recommended Indexes

```text
idx_audit_log_org

idx_audit_log_actor

idx_audit_log_entity

idx_audit_log_timestamp

idx_audit_log_operation
```

---

# Table — entity_change_history

## Purpose

Stores before-and-after values for tracked entities.

This table SHALL support historical reconstruction.

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| audit_log_id | UUID |
| entity_name | VARCHAR(100) |
| entity_id | UUID |
| changed_column | VARCHAR(100) |
| previous_value | JSONB |
| new_value | JSONB |
| created_at | TIMESTAMPTZ |

---

## Business Rules

Only modified fields SHALL be recorded.

Unchanged values SHALL NOT generate history entries.

---

## Recommended Indexes

```text
idx_change_history_entity

idx_change_history_column
```

---

# Table — user_activity

## Purpose

Maintains a chronological activity timeline for users.

Examples include:

```text
Logged In

Created Invoice

Approved Expense

Completed Production Batch

Transferred Inventory

Generated Report
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| user_profile_id | UUID |
| activity_type | VARCHAR(100) |
| description | TEXT |
| reference_table | VARCHAR(100) |
| reference_id | UUID |
| occurred_at | TIMESTAMPTZ |
| metadata | JSONB |

---

## Recommended Indexes

```text
idx_user_activity_user

idx_user_activity_time

idx_user_activity_type
```

---

# Table — security_event

## Purpose

Stores security-sensitive events.

Examples:

```text
Failed Login

Password Reset

Role Change

Permission Escalation

API Key Created

API Key Revoked

Account Locked
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| user_profile_id | UUID |
| severity | VARCHAR(20) |
| event_type | VARCHAR(100) |
| event_details | JSONB |
| ip_address | INET |
| occurred_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

---

## Severity Levels

```text
info

warning

high

critical
```

---

## Recommended Indexes

```text
idx_security_event_severity

idx_security_event_time

idx_security_event_user
```

---

# Table — compliance_record

## Purpose

Stores compliance-related evidence.

Examples:

```text
Financial Close

Data Export

Privacy Request

Audit Completion

Policy Acceptance

Regulatory Submission
```

---

## Columns

| Column | Type |
|---------|------|
| id | UUID |
| tenant_id | UUID |
| compliance_type | VARCHAR(100) |
| reference_table | VARCHAR(100) |
| reference_id | UUID |
| evidence | JSONB |
| retained_until | DATE |
| created_at | TIMESTAMPTZ |

---

## Recommended Indexes

```text
idx_compliance_type

idx_compliance_retention
```

---

# Audit Retention Policy

Recommended minimum retention:

| Record Type | Retention |
|-------------|-----------|
| Audit Logs | 7 Years |
| Financial Events | Permanent |
| Security Events | 7 Years |
| User Activity | 3 Years |
| Compliance Records | Regulatory Requirement |

Organizations MAY extend retention periods.

---

# Immutable Record Policy

The following SHALL NEVER permit:

- UPDATE
- DELETE

Tables:

```text
audit_log

entity_change_history

security_event

compliance_record
```

Corrections SHALL always generate new audit records.

---

# Source Tracking

Every audit event SHOULD capture:

```text
Application

API

Background Job

Migration

Webhook

System Process
```

This information SHALL be stored within `metadata`.

---

# Correlation IDs

Every request SHOULD generate:

```text
request_id UUID
```

This identifier SHALL link:

- API Requests
- Audit Logs
- Background Jobs
- Notifications
- Integration Events

Cross-system tracing SHALL be supported.

---

# Row-Level Security

The following tables SHALL enable RLS:

```text
audit_log

entity_change_history

user_activity

security_event

compliance_record
```

Audit administrators MAY receive broader visibility through dedicated permissions.

---

# Trigger Requirements

Audit triggers SHOULD automatically capture changes for:

- Financial Tables
- Inventory Tables
- Production Tables
- User Management
- Configuration Tables

Reference implementation SHALL be provided in the Functions section.

---

# Validation Checklist

The Audit & Compliance module SHALL verify:

- Immutable audit logs.
- Entity change history implemented.
- User activity timeline available.
- Security events tracked.
- Compliance evidence retained.
- Correlation IDs supported.
- Retention policies implemented.
- RLS enabled.
- Automatic auditing configured.

The Audit & Compliance module SHALL be completed before implementing Database Functions, Triggers, Views, Materialized Views, and Migration Specifications.

---

END OF CHUNK 21/42

Next:

Chunk 22/42 — PostgreSQL Functions, Stored Procedures & Trigger Implementation (Utility Functions, Business Logic, Trigger Functions, Validation Functions, Scheduled Procedures)

Append this chunk immediately below Chunk 21/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
22/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 21/42

Status:
Continuation

========================================

# PostgreSQL Functions, Stored Procedures & Trigger Implementation

## Purpose

This section defines BakeFlow's PostgreSQL function library.

Business logic SHALL be centralized inside PostgreSQL where transactional consistency is required.

Functions SHALL provide:

- Data Validation
- Inventory Calculations
- Financial Posting
- Number Generation
- Audit Logging
- Security Validation
- KPI Refresh
- Scheduled Maintenance

Reusable logic SHALL NOT be duplicated across application services.

---

# Function Organization

All reusable functions SHALL reside within dedicated schemas.

Recommended structure:

```text
public

Shared utilities


inventory

Inventory logic


finance

Accounting functions


production

Manufacturing functions


security

Authentication

Authorization

Audit


analytics

Reporting

KPI refresh
```

---

# Utility Function — update_timestamp()

## Purpose

Automatically updates the `updated_at` column.

---

## Signature

```sql
update_timestamp()

RETURNS trigger
```

---

## Behavior

Whenever:

```text
UPDATE
```

occurs,

the trigger SHALL execute:

```text
NEW.updated_at

=

NOW()
```

---

## Attached Tables

Recommended for:

- organization
- branch
- employee
- customer
- supplier
- warehouse
- product
- ingredient
- account

and all mutable master tables.

---

# Utility Function — generate_document_number()

## Purpose

Generates sequential document numbers.

---

## Signature

```sql
generate_document_number(

document_type,

tenant_id,

branch_id

)
```

---

## Example Output

```text
SO-2026-000001

INV-2026-000034

PO-2026-000012

PRD-2026-000876
```

---

## Business Rules

Sequences SHALL remain unique per:

```text
Organization

+

Document Type
```

Branch-specific numbering MAY be enabled through configuration.

---

# Utility Function — current_inventory_balance()

## Purpose

Returns the current inventory quantity.

---

## Signature

```sql
current_inventory_balance(

inventory_item_id,

warehouse_id

)
```

---

## Logic

```text
SUM(

Inventory Movements

)

=

Current Balance
```

Balances SHALL never rely on stored quantities.

---

# Inventory Function — reserve_inventory()

## Purpose

Creates inventory reservations.

---

## Signature

```sql
reserve_inventory(

sales_order_line_id

)
```

---

## Business Rules

Reservation SHALL:

- Reduce available quantity.
- Preserve physical quantity.
- Reject reservations exceeding availability.

---

# Inventory Function — release_inventory()

## Purpose

Releases reserved inventory.

---

## Triggered By

Examples:

- Order Cancellation
- Fulfilment Completion
- Reservation Expiry

---

# Inventory Function — post_inventory_movement()

## Purpose

Creates immutable inventory ledger entries.

---

## Signature

```sql
post_inventory_movement(

movement_type,

inventory_item,

quantity,

cost

)
```

---

## Business Rules

All inventory changes SHALL use this function.

Direct inserts into `inventory_movement` SHOULD be prohibited for application roles.

---

# Production Function — calculate_recipe_cost()

## Purpose

Calculates estimated recipe cost.

---

## Formula

```text
Σ

(

Ingredient Quantity

×

Current Ingredient Cost

)
```

---

## Return Value

```text
money_amount
```

---

# Production Function — complete_production_batch()

## Purpose

Finalizes production.

---

## Responsibilities

The function SHALL:

- Record output.
- Record consumption.
- Create inventory movements.
- Calculate production cost.
- Mark batch completed.

Execution SHALL occur within one database transaction.

---

# Finance Function — post_journal_entry()

## Purpose

Posts balanced journals.

---

## Signature

```sql
post_journal_entry(

journal_entry_id

)
```

---

## Validation

Before posting:

- Accounting period open.
- Balanced journal.
- Active accounts.
- Draft status.

Any failure SHALL rollback the transaction.

---

# Finance Function — reverse_journal()

## Purpose

Creates reversal journals.

---

## Business Rules

Original journals SHALL remain unchanged.

Reversal journals SHALL:

- Reverse debit/credit values.
- Preserve source references.
- Link to original journal.

---

# Finance Function — customer_balance()

## Purpose

Calculates customer outstanding balance.

---

## Formula

```text
Invoices

-

Payments

-

Credits
```

Balances SHALL always calculate dynamically.

---

# Finance Function — supplier_balance()

## Purpose

Calculates supplier outstanding liability.

---

## Formula

```text
Supplier Invoices

-

Payments

-

Returns
```

---

# Security Function — has_permission()

## Purpose

Determines whether a user possesses a specific permission.

---

## Signature

```sql
has_permission(

user_id,

permission_code

)
```

---

## Return

```text
BOOLEAN
```

This function SHALL support Row-Level Security policies.

---

# Security Function — current_organization()

## Purpose

Returns the authenticated user's organization.

---

## Example

```sql
SELECT current_organization();
```

---

## Usage

Recommended inside:

- RLS Policies
- Views
- Functions

---

# Security Function — audit_event()

## Purpose

Creates immutable audit records.

---

## Parameters

```text
Actor

Event

Entity

Operation

Metadata
```

---

## Triggered By

- INSERT
- UPDATE
- DELETE
- Approval
- Login
- Logout

---

# Analytics Function — refresh_dashboard_cache()

## Purpose

Refreshes cached dashboard metrics.

---

## Execution

Recommended:

```text
Every 5 Minutes
```

using `pg_cron` or Supabase Scheduled Functions.

---

# Analytics Function — refresh_materialized_views()

## Purpose

Refreshes reporting materialized views.

---

## Refresh Order

```text
Sales

↓

Inventory

↓

Profitability

↓

Executive Dashboard
```

Dependencies SHALL refresh in order.

---

# Trigger Function — validate_posted_documents()

## Purpose

Prevents modification of finalized records.

---

## Applies To

```text
Invoices

Journal Entries

Inventory Movements

Production Batches

Payments

Receipts
```

---

## Rule

Attempting:

```text
UPDATE

DELETE
```

on posted records SHALL raise an exception.

---

# Trigger Function — audit_changes()

## Purpose

Automatically records entity changes.

---

## Responsibilities

Capture:

- Previous Values
- New Values
- Changed Columns
- User
- Timestamp

Results SHALL populate:

```text
audit_log

entity_change_history
```

---

# Scheduled Procedures

Recommended recurring procedures:

| Procedure | Frequency |
|------------|-----------|
| Refresh KPIs | Every 5 Minutes |
| Refresh Materialized Views | Hourly |
| Cleanup Expired Cache | Hourly |
| Retry Notifications | Every Minute |
| Retry Integrations | Every Minute |
| Archive Old Logs | Daily |
| Expire Sessions | Every 15 Minutes |

---

# Exception Handling

Every business-critical function SHALL:

- Use explicit transactions.
- Roll back on failure.
- Raise descriptive SQL exceptions.
- Record audit events.
- Return deterministic results.

Silent failures SHALL never occur.

---

# Security Requirements

Functions performing privileged operations SHALL use:

```sql
SECURITY DEFINER
```

only where absolutely necessary.

Application-facing functions SHOULD default to:

```sql
SECURITY INVOKER
```

The principle of least privilege SHALL apply.

---

# Validation Checklist

The PostgreSQL Function Library SHALL verify:

- Timestamp automation implemented.
- Document numbering centralized.
- Inventory balance calculation reusable.
- Inventory posting protected.
- Production completion transactional.
- Journal posting validated.
- Journal reversal supported.
- Balance calculation reusable.
- Permission checks centralized.
- Audit logging automated.
- Materialized view refresh automated.
- Trigger functions implemented.
- Scheduled procedures defined.
- Security best practices enforced.

The PostgreSQL Function Library SHALL be completed before implementing Views, Materialized Views, RLS Policies, Database Migrations, and Deployment Specifications.

---

END OF CHUNK 22/42

Next:

Chunk 23/42 — Database Views, Materialized Views & Query Optimization Implementation (Operational Views, Reporting Views, Search Optimization, Performance Tuning, Index Strategy)

Append this chunk immediately below Chunk 22/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
23/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 22/42

Status:
Continuation

========================================

# Database Views, Materialized Views & Query Optimization Implementation

## Purpose

This section defines BakeFlow's database optimization strategy.

Views SHALL provide simplified access to operational data.

Materialized Views SHALL improve reporting performance.

Indexes SHALL optimize high-frequency queries.

The optimization layer SHALL ensure the platform scales efficiently from a single bakery to multi-branch enterprise deployments.

---

# Optimization Architecture

```text
Application

↓

Views

↓

Materialized Views

↓

Indexes

↓

Base Tables
```

Applications SHOULD query Views whenever business logic requires data aggregation.

Materialized Views SHALL be used for expensive reporting workloads.

---

# Schema Organization

Recommended structure:

```text
public

Core Tables


reporting

Operational Views


analytics

Materialized Views


security

RLS Helper Views
```

---

# Operational View — vw_active_customers

## Purpose

Returns active customers only.

---

## Source

```text
customer
```

---

## Filters

```text
is_active = TRUE
```

---

## Output

```text
Customer Code

Customer Name

Phone

Email

Credit Balance

Credit Limit
```

---

# Operational View — vw_active_products

## Purpose

Returns products available for sale.

---

## Filters

```text
is_active = TRUE

AND

is_sellable = TRUE
```

---

## Output

```text
Product

Category

Price

Cost

Barcode

SKU
```

---

# Operational View — vw_inventory_balance

## Purpose

Provides current inventory balances.

Balances SHALL be calculated from inventory movements.

---

## Formula

```text
SUM(

Inventory Movement

)

=

Current Quantity
```

Stored stock quantities SHALL never be referenced.

---

## Output

```text
Warehouse

Inventory Item

Current Quantity

Reserved Quantity

Available Quantity
```

---

# Operational View — vw_open_sales_orders

## Purpose

Returns outstanding customer orders.

---

## Status Filter

```text
confirmed

processing

ready
```

Cancelled and delivered orders SHALL be excluded.

---

# Operational View — vw_open_purchase_orders

## Purpose

Returns supplier purchase orders awaiting completion.

---

## Status Filter

```text
approved

sent

partially_received
```

---

# Operational View — vw_outstanding_receivables

## Purpose

Returns unpaid customer invoices.

---

## Output

```text
Customer

Invoice

Invoice Date

Due Date

Outstanding Balance

Days Outstanding
```

---

# Operational View — vw_outstanding_payables

## Purpose

Returns unpaid supplier invoices.

---

## Output

```text
Supplier

Invoice

Due Date

Outstanding Amount
```

---

# Operational View — vw_production_schedule

## Purpose

Displays planned and active production batches.

---

## Output

```text
Batch Number

Recipe

Planned Quantity

Status

Start Time

Assigned Branch
```

---

# Materialized View — mv_sales_summary

## Purpose

Accelerates sales reporting.

---

## Source Tables

```text
sales_order

customer_invoice

customer_payment
```

---

## Output

```text
Daily Sales

Weekly Sales

Monthly Sales

Revenue

Tax

Discounts
```

---

# Materialized View — mv_inventory_valuation

## Purpose

Calculates inventory valuation.

---

## Formula

```text
Current Quantity

×

Average Cost
```

---

## Output

```text
Warehouse

Inventory Item

Quantity

Average Cost

Inventory Value
```

---

# Materialized View — mv_customer_statistics

## Purpose

Provides customer performance metrics.

---

## Metrics

```text
Lifetime Revenue

Outstanding Balance

Average Order Value

Last Purchase

Purchase Frequency
```

---

# Materialized View — mv_supplier_statistics

## Purpose

Provides supplier analytics.

---

## Metrics

```text
Purchase Volume

Average Delivery Time

Outstanding Payables

Purchase Frequency
```

---

# Materialized View — mv_employee_performance

## Purpose

Supports operational performance reporting.

---

## Metrics

```text
Orders Processed

Production Output

Deliveries Completed

Sales Generated

Attendance

Productivity Score
```

---

# Materialized View — mv_branch_performance

## Purpose

Provides branch-level analytics.

---

## Metrics

```text
Revenue

Expenses

Gross Profit

Net Profit

Production

Inventory Value

Cash Balance
```

---

# Materialized View — mv_executive_dashboard

## Purpose

Provides pre-aggregated executive metrics.

---

## Dashboard Metrics

```text
Today's Sales

Today's Profit

Outstanding Receivables

Outstanding Payables

Inventory Value

Cash Position

Production Output

Waste %

Top Selling Products
```

---

# Refresh Dependencies

Refresh order SHALL be:

```text
Inventory

↓

Sales

↓

Finance

↓

Production

↓

Executive Dashboard
```

Dependent materialized views SHALL refresh after source views.

---

# Full-Text Search Strategy

The following tables SHOULD support PostgreSQL full-text search:

```text
customer

supplier

product

ingredient

employee

sales_order

customer_invoice
```

---

# Search Extensions

Required PostgreSQL extensions:

```sql
pg_trgm

unaccent
```

---

# Example Search Index

```sql
CREATE INDEX idx_product_name_trgm

ON product

USING GIN (

product_name gin_trgm_ops

);
```

---

# Composite Index Strategy

Recommended composite indexes:

```text
tenant_id

+

status
```

```text
tenant_id

+

created_at
```

```text
tenant_id

+

branch_id
```

```text
tenant_id

+

document_number
```

These SHALL optimize the most common application queries.

---

# Partial Index Strategy

Recommended partial indexes:

```sql
WHERE

is_active = TRUE
```

Examples:

```text
Customers

Products

Employees

Suppliers

Warehouses
```

---

# Covering Index Strategy

Frequently queried financial tables SHOULD utilize covering indexes for:

```text
Journal Date

Account

Accounting Period

Organization
```

to minimize table lookups.

---

# Query Optimization Guidelines

Queries SHALL:

- Filter by `tenant_id` first.
- Use indexed columns in predicates.
- Avoid `SELECT *`.
- Prefer pagination over large result sets.
- Use prepared statements.
- Minimize nested subqueries.
- Favor indexed joins.

---

# Pagination Strategy

Large datasets SHALL use:

```sql
LIMIT

OFFSET
```

or preferably:

```sql
Keyset Pagination
```

for improved performance on high-volume tables.

---

# Execution Plan Monitoring

Database administrators SHOULD periodically review:

```sql
EXPLAIN ANALYZE
```

for:

- Slow Queries
- Sequential Scans
- Missing Indexes
- Inefficient Joins

Performance regressions SHALL be addressed before production deployment.

---

# Row-Level Security

Views SHALL inherit Row-Level Security from underlying tables.

Materialized Views SHALL either:

- Be refreshed by privileged service roles, or
- Include organization-specific filtering.

Cross-organization visibility SHALL never occur.

---

# Validation Checklist

The Optimization module SHALL verify:

- Operational views implemented.
- Materialized views implemented.
- Refresh dependencies defined.
- Full-text search enabled.
- Composite indexes created.
- Partial indexes created.
- Covering indexes implemented.
- Query optimization guidelines followed.
- Execution plans monitored.
- RLS preserved across views.

The Database Optimization module SHALL be completed before implementing Row-Level Security Policies, Database Migrations, Backup Strategy, and Deployment Architecture.

---

END OF CHUNK 23/42

Next:

Chunk 24/42 — Row-Level Security (RLS), Authorization Policies & Multi-Tenant Isolation Implementation (Policies, Helper Functions, Access Enforcement, Service Roles, Security Testing)

Append this chunk immediately below Chunk 23/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
24/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 23/42

Status:
Continuation

========================================

# Row-Level Security (RLS), Authorization Policies & Multi-Tenant Isolation Implementation

## Purpose

This section defines BakeFlow's multi-tenant security architecture.

Row-Level Security (RLS) SHALL be the primary enforcement mechanism preventing data leakage between organizations.

Every database query SHALL be evaluated through RLS policies.

Application code SHALL NOT be relied upon for tenant isolation.

---

# Security Architecture

```text
Authenticated User

↓

JWT Claims

↓

Security Functions

↓

RLS Policies

↓

Database Tables

↓

Authorized Records
```

Security SHALL be enforced inside PostgreSQL.

---

# Multi-Tenant Model

BakeFlow SHALL use:

```text
Shared Database

↓

Shared Schema

↓

Organization Isolation

↓

Row-Level Security
```

Every business record SHALL belong to exactly one organization unless explicitly designated as global system data.

---

# Organization Ownership

Every tenant-owned table SHALL contain:

```sql
tenant_id UUID NOT NULL
```

Examples include:

```text
customer

supplier

employee

branch

warehouse

product

sales_order

purchase_order

journal_entry

inventory_item
```

---

# Global Tables

The following MAY remain global:

```text
country

currency

system_permission

system_role

migration_history

supported_language
```

Global tables SHALL remain read-only for tenant users.

---

# Security Helper Function — current_organization()

## Purpose

Returns the authenticated organization.

---

## Signature

```sql
current_organization()

RETURNS UUID
```

---

## Example

```sql
SELECT current_organization();
```

---

## Source

The value SHALL be extracted from:

```text
JWT Claims
```

---

# Security Helper Function — current_user_profile()

## Purpose

Returns the authenticated user profile.

---

## Signature

```sql
current_user_profile()

RETURNS UUID
```

---

# Security Helper Function — has_permission()

## Purpose

Checks application permissions.

---

## Signature

```sql
has_permission(

permission_code

)

RETURNS BOOLEAN
```

---

## Example

```sql
SELECT has_permission(

'inventory.adjust'

);
```

---

# Security Helper Function — current_branch()

## Purpose

Returns the authenticated branch.

Branch filtering MAY be enabled for branch-restricted users.

---

# Default SELECT Policy

Every organization-owned table SHOULD implement:

```sql
USING (

tenant_id

=

current_organization()

)
```

Users SHALL only view records belonging to their organization.

---

# Default INSERT Policy

Example:

```sql
WITH CHECK (

tenant_id

=

current_organization()

)
```

Users SHALL never insert records into another organization.

---

# Default UPDATE Policy

Users SHALL only update rows satisfying:

```sql
tenant_id

=

current_organization()
```

---

# Default DELETE Policy

Deletes SHALL remain restricted.

Only authorized roles MAY delete mutable records.

Historical financial records SHALL never permit deletion.

---

# Example Customer Policy

```sql
CREATE POLICY customer_select

ON customer

FOR SELECT

USING (

tenant_id

=

current_organization()

);
```

---

# Example Inventory Policy

```sql
CREATE POLICY inventory_policy

ON inventory_item

USING (

tenant_id

=

current_organization()

);
```

---

# Example Journal Policy

Posted journals SHALL remain read-only.

Example:

```sql
status <> 'posted'
```

for UPDATE permissions.

---

# Branch-Level Security

Organizations MAY enable optional branch restrictions.

Example:

```sql
branch_id

=

current_branch()
```

Managers MAY receive access to multiple branches.

Owners MAY bypass branch restrictions while remaining limited to their organization.

---

# Role-Based Authorization

Typical authorization hierarchy:

```text
System Administrator

↓

Organization Owner

↓

Manager

↓

Supervisor

↓

Cashier

↓

Production Staff

↓

Driver

↓

Employee
```

Permissions SHALL determine actions.

RLS SHALL determine accessible rows.

---

# Service Role Access

Backend service roles MAY bypass RLS only for:

- Scheduled Jobs
- Migrations
- Materialized View Refreshes
- Notification Processing
- Integration Processing

Service credentials SHALL never be exposed to client applications.

---

# Anonymous Access

Anonymous users SHALL NOT access tenant tables.

Permitted anonymous resources MAY include:

```text
Health Check

Public Documentation

Marketing Website
```

No operational data SHALL be exposed.

---

# Audit Integration

Authorization failures SHOULD generate:

```text
security_event

audit_log
```

Repeated failures MAY trigger automated account protection.

---

# JWT Requirements

Required JWT claims:

```text
user_id

tenant_id

branch_id

role

permissions

session_id
```

Claims SHALL be validated before use.

---

# Policy Testing

Every RLS policy SHALL be tested for:

- Authorized SELECT
- Unauthorized SELECT
- Authorized INSERT
- Unauthorized INSERT
- Authorized UPDATE
- Unauthorized UPDATE
- Authorized DELETE
- Unauthorized DELETE

Cross-tenant access SHALL always fail.

---

# Recommended Security Tests

Verify:

```text
Organization A

cannot access

Organization B
```

Verify:

```text
Branch A

cannot access

restricted Branch B
```

Verify:

```text
Driver

cannot approve

Payroll
```

Verify:

```text
Cashier

cannot modify

Journal Entries
```

---

# Performance Considerations

RLS predicates SHOULD utilize indexed columns.

Minimum required indexes:

```text
tenant_id

branch_id

created_by

status
```

Security predicates SHALL remain performant at scale.

---

# Security Best Practices

Implementations SHALL:

- Enable RLS on every tenant table.
- Deny access by default.
- Grant only required permissions.
- Avoid SECURITY DEFINER unless necessary.
- Validate JWT claims.
- Audit privileged operations.
- Rotate service credentials regularly.

---

# Validation Checklist

The RLS & Authorization module SHALL verify:

- RLS enabled on tenant tables.
- Organization isolation enforced.
- Branch isolation supported.
- Global tables protected.
- Helper functions implemented.
- Default CRUD policies created.
- Service role access restricted.
- JWT claims validated.
- Authorization failures audited.
- Cross-tenant access prevented.

The RLS & Authorization module SHALL be completed before implementing Database Migrations, Seed Data, Backup Strategy, Disaster Recovery, and Production Deployment.

---

END OF CHUNK 24/42

Next:

Chunk 25/42 — Database Migration Strategy, Seed Data & Versioning Implementation (Migration Standards, Seed Data, Rollback Strategy, Schema Versioning, Deployment Safety)

Append this chunk immediately below Chunk 24/42.

========================================````markdown id="eb016-c25"
========================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
25/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 24/42

Status:
Continuation

========================================

# Database Migration Strategy, Seed Data & Versioning Implementation

## Purpose

This section defines BakeFlow's database migration, versioning, and deployment strategy.

Every schema modification SHALL be:

- Version controlled
- Repeatable
- Atomic
- Reversible (where practical)
- Auditable
- Automated

Manual production database modifications SHALL be prohibited.

---

# Migration Philosophy

BakeFlow SHALL implement:

```text
Code

↓

Migration

↓

Deployment

↓

Verification

↓

Production
```

Every database change SHALL originate from source control.

---

# Migration Directory Structure

Recommended structure:

```text
supabase/

└── migrations/

        20260701090000_initial_schema.sql

        20260702093000_add_inventory.sql

        20260703100000_add_finance.sql

        20260704113000_add_indexes.sql

        20260705150000_rls_policies.sql

        20260706100000_seed_reference_data.sql
```

Migration filenames SHALL begin with UTC timestamps.

---

# Migration Naming Convention

Recommended format:

```text
YYYYMMDDHHMMSS_description.sql
```

Example:

```text
20260703124500_create_sales_tables.sql
```

Names SHALL remain descriptive and immutable.

---

# Migration Categories

Recommended sequence:

```text
001

Extensions

↓

002

Custom Types

↓

003

Domains

↓

004

Core Tables

↓

005

Relationships

↓

006

Indexes

↓

007

Functions

↓

008

Triggers

↓

009

Views

↓

010

Materialized Views

↓

011

RLS Policies

↓

012

Seed Data
```

Dependencies SHALL always execute in order.

---

# Transaction Requirements

Every migration SHALL execute inside a transaction.

Example:

```sql
BEGIN;

...

COMMIT;
```

Failure SHALL automatically roll back the migration.

---

# Idempotency

Migrations SHALL use defensive statements whenever possible.

Examples:

```sql
CREATE TABLE IF NOT EXISTS
```

```sql
CREATE INDEX IF NOT EXISTS
```

```sql
DROP VIEW IF EXISTS
```

Migration scripts SHALL remain safely repeatable in non-production environments.

---

# Schema Version Table

## Table — schema_version

### Purpose

Tracks applied database versions.

---

## Columns

| Column | Type |
|---------|------|
| version | VARCHAR(50) |
| description | TEXT |
| checksum | TEXT |
| applied_at | TIMESTAMPTZ |
| applied_by | VARCHAR(100) |

---

## Business Rules

Applied migrations SHALL never be removed from history.

Checksums SHOULD detect migration tampering.

---

# Seed Data Strategy

Seed data SHALL be divided into:

```text
System Data

Reference Data

Demo Data

Test Data
```

Each category SHALL remain independent.

---

# System Seed Data

System seed data MAY include:

```text
Countries

Currencies

Time Zones

Languages

Permission Definitions

Role Definitions
```

These records SHALL remain read-only.

---

# Reference Seed Data

Reference data MAY include:

```text
Units of Measure

Expense Categories

Inventory Movement Types

Document Types

Account Categories

Notification Templates
```

Organizations MAY extend these values.

---

# Organization Initialization

Creating a new organization SHALL automatically generate:

- Default Branch
- Default Warehouse
- Default Fiscal Year
- Default Chart of Accounts
- Default Roles
- Default Permissions
- Default Units of Measure
- Default Categories

Initialization SHALL execute atomically.

---

# Demo Data

Demo environments MAY include:

```text
Customers

Suppliers

Products

Recipes

Orders

Invoices
```

Production environments SHALL NOT install demo data.

---

# Rollback Strategy

Schema rollbacks SHALL only occur when:

- Deployment Failure
- Data Integrity Failure
- Critical Production Incident

Data rollbacks SHALL require explicit approval.

---

# Rollback Guidelines

Safe rollback examples:

```text
Drop Newly Added Table

Drop New View

Remove New Function

Drop New Index
```

Unsafe rollback examples:

```text
Delete Production Data

Modify Financial History

Remove Posted Journals

Delete Inventory Ledger
```

Irreversible migrations SHALL include documented recovery procedures.

---

# Backward Compatibility

Application deployments SHALL support:

```text
Application Version N

↓

Database Version N

↓

Application Version N+1

↓

Database Version N+1
```

Application releases SHALL remain compatible during rolling deployments.

---

# Feature Flags

Large schema changes SHOULD utilize:

```text
Feature Flags
```

Examples:

- New Sales Module
- AI Features
- New Dashboard
- Payroll
- Fixed Assets

Database deployment SHALL precede feature activation.

---

# Migration Testing

Every migration SHALL be tested against:

- Empty Database
- Existing Production Snapshot
- Latest Development Database

Testing SHALL verify:

- Successful execution.
- Rollback behavior.
- Data preservation.
- Performance impact.

---

# Deployment Pipeline

Recommended deployment flow:

```text
Developer

↓

Git

↓

CI

↓

Migration Validation

↓

Automated Tests

↓

Staging

↓

Approval

↓

Production
```

Production deployments SHALL require successful validation.

---

# Post-Deployment Verification

Immediately after deployment, verify:

- Migration completed successfully.
- RLS policies active.
- Indexes created.
- Functions compiled.
- Triggers attached.
- Materialized views refreshed.
- Seed data inserted.
- Application health checks passing.

---

# Version Compatibility Matrix

Maintain compatibility records for:

| Application | Database |
|-------------|----------|
| v1.0 | Schema v1 |
| v1.1 | Schema v2 |
| v2.0 | Schema v3 |

Breaking changes SHALL require explicit version upgrades.

---

# Backup Before Migration

Production deployments SHALL create:

```text
Full Database Backup

↓

Migration

↓

Verification

↓

Release
```

Rollback SHALL always have a recoverable backup.

---

# Validation Checklist

The Migration Strategy module SHALL verify:

- Timestamped migration files.
- Ordered migration execution.
- Transactional migrations.
- Schema version tracking.
- Seed data separated.
- Organization initialization automated.
- Rollback strategy documented.
- Deployment pipeline defined.
- Post-deployment verification implemented.
- Backup before migration enforced.

The Migration Strategy module SHALL be completed before implementing Backup & Disaster Recovery, Performance Tuning, Production Deployment, and Operational Maintenance.

---

END OF CHUNK 25/42

Next:

Chunk 26/42 — Backup, Disaster Recovery & High Availability Implementation (Backup Strategy, Point-in-Time Recovery, Replication, Failover, Restore Testing, Operational Recovery Procedures)

Append this chunk immediately below Chunk 25/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
26/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 25/42

Status:
Continuation

========================================

# Backup, Disaster Recovery & High Availability Implementation

## Purpose

This section defines BakeFlow's database resilience strategy.

The platform SHALL maintain continuous availability while ensuring that business-critical data can be recovered from accidental deletion, corruption, infrastructure failures, or disasters.

The implementation SHALL support:

- Automated Backups
- Point-in-Time Recovery (PITR)
- Disaster Recovery
- Replication
- High Availability
- Restore Verification
- Operational Runbooks
- Recovery Objectives

Business continuity SHALL be considered a core platform requirement.

---

# High-Level Recovery Architecture

```text
Production Database

↓

Continuous WAL Archiving

↓

Automated Backups

↓

Backup Storage

↓

Disaster Recovery Site

↓

Restore Environment
```

Recovery SHALL never depend on manual database exports.

---

# Backup Strategy

BakeFlow SHALL implement multiple backup layers.

Recommended schedule:

| Backup Type | Frequency |
|--------------|-----------|
| WAL Archive | Continuous |
| Incremental Backup | Daily |
| Full Backup | Weekly |
| Long-Term Archive | Monthly |

Organizations MAY increase backup frequency based on operational requirements.

---

# Backup Components

Each backup SHALL include:

```text
Database

↓

Roles

↓

Functions

↓

Extensions

↓

Triggers

↓

Views

↓

Materialized Views

↓

RLS Policies
```

Application configuration SHOULD be backed up separately.

---

# Backup Retention Policy

Recommended retention:

| Backup | Retention |
|----------|-----------|
| Daily | 30 Days |
| Weekly | 12 Weeks |
| Monthly | 12 Months |
| Annual | 7 Years |

Financial compliance MAY require longer retention.

---

# Backup Storage Strategy

Backups SHALL exist in multiple locations.

Recommended:

```text
Primary Region

↓

Secondary Region

↓

Offline Archive
```

Single-location backups SHALL NOT be considered sufficient.

---

# Encryption

Every backup SHALL be encrypted.

Recommended standards:

```text
AES-256

↓

Encrypted Storage

↓

Encrypted Transfer
```

Encryption keys SHALL be managed independently from database credentials.

---

# Point-in-Time Recovery (PITR)

Continuous WAL archiving SHALL enable restoration to any specific point.

Example:

```text
09:00

↓

Invoice Created

↓

09:12

↓

Accidental Deletion

↓

09:15

↓

Restore Database

↓

09:11:59
```

Point-in-Time Recovery SHALL minimize data loss.

---

# Recovery Objectives

Recommended operational targets:

| Metric | Target |
|----------|---------|
| RPO (Recovery Point Objective) | < 5 Minutes |
| RTO (Recovery Time Objective) | < 30 Minutes |

Mission-critical deployments MAY target lower values.

---

# Restore Workflow

Recommended procedure:

```text
Provision Database

↓

Restore Backup

↓

Replay WAL

↓

Verify Integrity

↓

Switch Traffic

↓

Resume Operations
```

Every restore SHALL undergo verification before production use.

---

# Restore Verification

After every restore, verify:

- Database starts successfully.
- Migrations match expected version.
- RLS policies enabled.
- Functions compile.
- Triggers attached.
- Indexes present.
- Materialized views refresh.
- Application login succeeds.
- Reports generate correctly.

Incomplete restores SHALL NOT enter production.

---

# Disaster Recovery Site

Recommended deployment:

```text
Primary Region

↓

Standby Region

↓

Disaster Recovery Region
```

Standby infrastructure SHOULD remain synchronized.

---

# Replication Strategy

Recommended PostgreSQL replication:

```text
Primary

↓

Streaming Replica

↓

Read Replica(s)
```

Replication SHALL remain asynchronous unless business requirements demand synchronous replication.

---

# Read Replicas

Read replicas MAY support:

- Dashboards
- Analytics
- Reporting
- Search
- BI Queries

Write operations SHALL always target the primary database.

---

# Automatic Failover

Automatic failover SHOULD perform:

```text
Primary Failure

↓

Health Check Failure

↓

Replica Promotion

↓

DNS Update

↓

Application Reconnect
```

Failover SHALL preserve transactional consistency.

---

# Health Monitoring

Continuous monitoring SHOULD verify:

- Database availability.
- Replication lag.
- WAL archive status.
- Backup completion.
- Disk utilization.
- CPU utilization.
- Memory utilization.
- Query latency.

Operational alerts SHALL trigger before service degradation.

---

# Backup Integrity Testing

Backups SHALL undergo periodic testing.

Recommended schedule:

| Test | Frequency |
|------|-----------|
| Restore Test | Monthly |
| PITR Test | Quarterly |
| DR Simulation | Annually |

Untested backups SHALL NOT be considered reliable.

---

# Operational Recovery Runbooks

Documented runbooks SHOULD exist for:

- Accidental Record Deletion
- Database Corruption
- Hardware Failure
- Region Failure
- Ransomware Recovery
- Failed Migration
- Replication Failure
- Backup Failure

Runbooks SHALL remain version controlled.

---

# Business Continuity

During recovery:

Critical services SHOULD resume first:

```text
Authentication

↓

Sales

↓

Inventory

↓

Production

↓

Finance

↓

Reporting
```

Non-essential analytics MAY recover later.

---

# Backup Security

Access SHALL be restricted to authorized administrators.

Backups SHALL:

- Require authentication.
- Be encrypted.
- Be immutable where supported.
- Maintain access logs.
- Support audit review.

Backup credentials SHALL remain separate from production credentials.

---

# Recovery Documentation

Operational documentation SHOULD include:

- Recovery Procedures
- Contact Information
- Escalation Matrix
- Infrastructure Inventory
- Backup Locations
- Restore Commands
- Verification Checklist

Documentation SHALL be reviewed regularly.

---

# Validation Checklist

The Backup & Disaster Recovery module SHALL verify:

- Automated backups configured.
- WAL archiving enabled.
- PITR supported.
- Encryption enforced.
- Replication configured.
- Read replicas supported.
- Failover documented.
- Restore testing scheduled.
- Recovery objectives defined.
- Disaster recovery runbooks maintained.

The Backup & Disaster Recovery module SHALL be completed before implementing Production Deployment, Infrastructure Architecture, Monitoring, Logging, and Operational Maintenance.

---

END OF CHUNK 26/42

Next:

Chunk 27/42 — Production Deployment, Infrastructure & Environment Architecture (Supabase Configuration, Environments, Secrets Management, CI/CD, Infrastructure Standards, Production Hardening)

Append this chunk immediately below Chunk 26/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
27/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 26/42

Status:
Continuation

========================================

# Production Deployment, Infrastructure & Environment Architecture

## Purpose

This section defines BakeFlow's production deployment architecture.

The platform SHALL support secure, repeatable, automated deployments from development through production while minimizing downtime and operational risk.

The deployment architecture SHALL support:

- Local Development
- Development Environment
- Staging Environment
- Production Environment
- CI/CD Pipelines
- Secrets Management
- Infrastructure Hardening
- Environment Isolation

Infrastructure SHALL be managed as code wherever possible.

---

# Environment Architecture

```text
Developer

↓

Local Development

↓

Development

↓

Staging

↓

Production
```

Each environment SHALL remain isolated.

No production credentials SHALL exist in lower environments.

---

# Environment Definitions

## Local Development

Purpose:

- Feature development
- Unit testing
- Local debugging

Characteristics:

```text
Local Supabase

Mock Services

Development Secrets
```

---

## Development

Purpose:

- Team integration
- Shared testing

Characteristics:

```text
Shared Database

Shared Authentication

Shared Storage

Development APIs
```

---

## Staging

Purpose:

- Pre-production validation

Characteristics:

```text
Production-like Infrastructure

Production Configuration

Sanitized Data

Performance Testing
```

---

## Production

Purpose:

Serve real customers.

Requirements:

- High Availability
- Automated Backups
- Monitoring
- Alerting
- Disaster Recovery
- Security Hardening

---

# Supabase Project Separation

Recommended structure:

```text
BakeFlow Dev

↓

BakeFlow Staging

↓

BakeFlow Production
```

Each project SHALL use independent:

- Database
- Storage
- Authentication
- API Keys
- Secrets

---

# Environment Variables

Configuration SHALL be externalized.

Examples:

```text
SUPABASE_URL

SUPABASE_ANON_KEY

SUPABASE_SERVICE_ROLE_KEY

DATABASE_URL

JWT_SECRET

SMTP_HOST

SMTP_PORT

SMTP_USERNAME

SMTP_PASSWORD

SMS_PROVIDER_KEY

AI_PROVIDER_KEY
```

Secrets SHALL never be committed to source control.

---

# Secrets Management

Recommended providers:

```text
Supabase Secrets

GitHub Actions Secrets

Cloud Secret Manager

HashiCorp Vault
```

Secrets SHALL:

- Be encrypted.
- Rotate periodically.
- Remain environment-specific.
- Be access controlled.

---

# Infrastructure as Code

Infrastructure SHOULD be reproducible.

Recommended tools:

```text
Terraform

Pulumi

Supabase CLI

Docker Compose
```

Manual infrastructure provisioning SHOULD be minimized.

---

# Container Strategy

Application services SHOULD be containerized.

Example:

```text
React Native Build

↓

API Services

↓

Background Workers

↓

Monitoring Services
```

Containers SHALL remain stateless.

---

# CI/CD Pipeline

Recommended workflow:

```text
Git Commit

↓

Pull Request

↓

Lint

↓

Unit Tests

↓

Database Migration Validation

↓

Integration Tests

↓

Build

↓

Deploy to Staging

↓

Acceptance Tests

↓

Production Approval

↓

Production Deployment
```

Production deployment SHALL require successful validation.

---

# Branch Strategy

Recommended Git workflow:

```text
main

↓

release/*

↓

develop

↓

feature/*
```

Direct commits to `main` SHOULD be restricted.

---

# Deployment Strategy

Preferred deployment method:

```text
Blue

↓

Green

Deployment
```

Alternative:

```text
Rolling Deployment
```

Downtime SHOULD be minimized.

---

# Database Deployment Order

Database deployment SHALL occur before application deployment.

Recommended sequence:

```text
Backup

↓

Run Migrations

↓

Verify Schema

↓

Refresh Materialized Views

↓

Deploy Backend

↓

Deploy Frontend

↓

Run Smoke Tests
```

---

# Production Hardening

Production SHALL enforce:

- HTTPS only.
- TLS 1.2 or newer.
- Secure Headers.
- Rate Limiting.
- Request Logging.
- Input Validation.
- Secret Rotation.
- RLS Enforcement.

Debug endpoints SHALL be disabled.

---

# Logging Strategy

Logs SHOULD include:

- Application Logs
- API Logs
- Database Logs
- Authentication Logs
- Audit Logs
- Background Job Logs

Logs SHALL support centralized aggregation.

---

# Monitoring

Infrastructure monitoring SHALL include:

- CPU Usage
- Memory Usage
- Disk Usage
- Database Connections
- Slow Queries
- API Latency
- Queue Length
- Error Rate

Threshold breaches SHALL generate alerts.

---

# Health Checks

Health endpoints SHOULD verify:

```text
Database

↓

Authentication

↓

Storage

↓

Queue

↓

Notification Service

↓

External Integrations
```

Health checks SHALL remain lightweight.

---

# Release Versioning

Application versions SHOULD follow Semantic Versioning.

Example:

```text
Major.Minor.Patch

2.3.1
```

Database schema versions SHALL be tracked independently.

---

# Rollback Procedure

If deployment fails:

```text
Stop Deployment

↓

Restore Backup (if required)

↓

Rollback Application

↓

Verify Health

↓

Resume Service
```

Rollback SHALL be documented and tested.

---

# Operational Maintenance

Scheduled maintenance SHOULD include:

- Database Vacuum
- Index Analysis
- Materialized View Refresh
- Backup Verification
- Log Rotation
- Secret Rotation
- Dependency Updates

Maintenance windows SHALL be communicated to customers.

---

# Production Readiness Checklist

Before production deployment verify:

- All migrations applied.
- Backups completed.
- RLS enabled.
- Monitoring active.
- Alerts configured.
- Secrets configured.
- SSL certificates valid.
- Environment variables verified.
- Health checks passing.
- Smoke tests successful.

---

# Validation Checklist

The Production Deployment module SHALL verify:

- Environment separation implemented.
- Supabase projects isolated.
- Secrets securely managed.
- Infrastructure reproducible.
- CI/CD pipeline automated.
- Blue/Green or Rolling deployment supported.
- Database deployment order enforced.
- Production hardening completed.
- Monitoring configured.
- Rollback procedures documented.

The Production Deployment module SHALL be completed before implementing Observability, Performance Monitoring, Operational Maintenance, and Final System Validation.

---

END OF CHUNK 27/42

Next:

Chunk 28/42 — Observability, Monitoring & Operational Maintenance (Metrics, Logging, Alerting, Incident Response, Performance Monitoring, Operational Procedures)

Append this chunk immediately below Chunk 27/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
27/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 26/42

Status:
Continuation

========================================

# Production Deployment, Infrastructure & Environment Architecture

## Purpose

This section defines BakeFlow's production deployment architecture.

The platform SHALL support secure, repeatable, automated deployments from development through production while minimizing downtime and operational risk.

The deployment architecture SHALL support:

- Local Development
- Development Environment
- Staging Environment
- Production Environment
- CI/CD Pipelines
- Secrets Management
- Infrastructure Hardening
- Environment Isolation

Infrastructure SHALL be managed as code wherever possible.

---

# Environment Architecture

```text
Developer

↓

Local Development

↓

Development

↓

Staging

↓

Production
```

Each environment SHALL remain isolated.

No production credentials SHALL exist in lower environments.

---

# Environment Definitions

## Local Development

Purpose:

- Feature development
- Unit testing
- Local debugging

Characteristics:

```text
Local Supabase

Mock Services

Development Secrets
```

---

## Development

Purpose:

- Team integration
- Shared testing

Characteristics:

```text
Shared Database

Shared Authentication

Shared Storage

Development APIs
```

---

## Staging

Purpose:

- Pre-production validation

Characteristics:

```text
Production-like Infrastructure

Production Configuration

Sanitized Data

Performance Testing
```

---

## Production

Purpose:

Serve real customers.

Requirements:

- High Availability
- Automated Backups
- Monitoring
- Alerting
- Disaster Recovery
- Security Hardening

---

# Supabase Project Separation

Recommended structure:

```text
BakeFlow Dev

↓

BakeFlow Staging

↓

BakeFlow Production
```

Each project SHALL use independent:

- Database
- Storage
- Authentication
- API Keys
- Secrets

---

# Environment Variables

Configuration SHALL be externalized.

Examples:

```text
SUPABASE_URL

SUPABASE_ANON_KEY

SUPABASE_SERVICE_ROLE_KEY

DATABASE_URL

JWT_SECRET

SMTP_HOST

SMTP_PORT

SMTP_USERNAME

SMTP_PASSWORD

SMS_PROVIDER_KEY

AI_PROVIDER_KEY
```

Secrets SHALL never be committed to source control.

---

# Secrets Management

Recommended providers:

```text
Supabase Secrets

GitHub Actions Secrets

Cloud Secret Manager

HashiCorp Vault
```

Secrets SHALL:

- Be encrypted.
- Rotate periodically.
- Remain environment-specific.
- Be access controlled.

---

# Infrastructure as Code

Infrastructure SHOULD be reproducible.

Recommended tools:

```text
Terraform

Pulumi

Supabase CLI

Docker Compose
```

Manual infrastructure provisioning SHOULD be minimized.

---

# Container Strategy

Application services SHOULD be containerized.

Example:

```text
React Native Build

↓

API Services

↓

Background Workers

↓

Monitoring Services
```

Containers SHALL remain stateless.

---

# CI/CD Pipeline

Recommended workflow:

```text
Git Commit

↓

Pull Request

↓

Lint

↓

Unit Tests

↓

Database Migration Validation

↓

Integration Tests

↓

Build

↓

Deploy to Staging

↓

Acceptance Tests

↓

Production Approval

↓

Production Deployment
```

Production deployment SHALL require successful validation.

---

# Branch Strategy

Recommended Git workflow:

```text
main

↓

release/*

↓

develop

↓

feature/*
```

Direct commits to `main` SHOULD be restricted.

---

# Deployment Strategy

Preferred deployment method:

```text
Blue

↓

Green

Deployment
```

Alternative:

```text
Rolling Deployment
```

Downtime SHOULD be minimized.

---

# Database Deployment Order

Database deployment SHALL occur before application deployment.

Recommended sequence:

```text
Backup

↓

Run Migrations

↓

Verify Schema

↓

Refresh Materialized Views

↓

Deploy Backend

↓

Deploy Frontend

↓

Run Smoke Tests
```

---

# Production Hardening

Production SHALL enforce:

- HTTPS only.
- TLS 1.2 or newer.
- Secure Headers.
- Rate Limiting.
- Request Logging.
- Input Validation.
- Secret Rotation.
- RLS Enforcement.

Debug endpoints SHALL be disabled.

---

# Logging Strategy

Logs SHOULD include:

- Application Logs
- API Logs
- Database Logs
- Authentication Logs
- Audit Logs
- Background Job Logs

Logs SHALL support centralized aggregation.

---

# Monitoring

Infrastructure monitoring SHALL include:

- CPU Usage
- Memory Usage
- Disk Usage
- Database Connections
- Slow Queries
- API Latency
- Queue Length
- Error Rate

Threshold breaches SHALL generate alerts.

---

# Health Checks

Health endpoints SHOULD verify:

```text
Database

↓

Authentication

↓

Storage

↓

Queue

↓

Notification Service

↓

External Integrations
```

Health checks SHALL remain lightweight.

---

# Release Versioning

Application versions SHOULD follow Semantic Versioning.

Example:

```text
Major.Minor.Patch

2.3.1
```

Database schema versions SHALL be tracked independently.

---

# Rollback Procedure

If deployment fails:

```text
Stop Deployment

↓

Restore Backup (if required)

↓

Rollback Application

↓

Verify Health

↓

Resume Service
```

Rollback SHALL be documented and tested.

---

# Operational Maintenance

Scheduled maintenance SHOULD include:

- Database Vacuum
- Index Analysis
- Materialized View Refresh
- Backup Verification
- Log Rotation
- Secret Rotation
- Dependency Updates

Maintenance windows SHALL be communicated to customers.

---

# Production Readiness Checklist

Before production deployment verify:

- All migrations applied.
- Backups completed.
- RLS enabled.
- Monitoring active.
- Alerts configured.
- Secrets configured.
- SSL certificates valid.
- Environment variables verified.
- Health checks passing.
- Smoke tests successful.

---

# Validation Checklist

The Production Deployment module SHALL verify:

- Environment separation implemented.
- Supabase projects isolated.
- Secrets securely managed.
- Infrastructure reproducible.
- CI/CD pipeline automated.
- Blue/Green or Rolling deployment supported.
- Database deployment order enforced.
- Production hardening completed.
- Monitoring configured.
- Rollback procedures documented.

The Production Deployment module SHALL be completed before implementing Observability, Performance Monitoring, Operational Maintenance, and Final System Validation.

---

END OF CHUNK 27/42

Next:

Chunk 28/42 — Observability, Monitoring & Operational Maintenance (Metrics, Logging, Alerting, Incident Response, Performance Monitoring, Operational Procedures)

Append this chunk immediately below Chunk 27/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
28/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 27/42

Status:
Continuation

========================================

# Observability, Monitoring & Operational Maintenance

## Purpose

This section defines BakeFlow's observability and operational maintenance architecture.

The platform SHALL provide complete visibility into application health, infrastructure performance, database behavior, business operations, and security events.

The implementation SHALL support:

- Metrics Collection
- Centralized Logging
- Distributed Tracing
- Alerting
- Incident Management
- Performance Monitoring
- Capacity Planning
- Operational Runbooks

Observability SHALL be built into every production deployment.

---

# Observability Architecture

```text
Application

↓

Metrics

↓

Logs

↓

Traces

↓

Monitoring Platform

↓

Alert Engine

↓

Incident Response

↓

Operations Team
```

All critical services SHALL emit telemetry.

---

# Three Pillars of Observability

BakeFlow SHALL implement:

```text
Metrics

↓

Logs

↓

Distributed Traces
```

Each pillar SHALL complement the others.

---

# Metrics Collection

The platform SHALL collect:

### Infrastructure Metrics

```text
CPU Usage

Memory Usage

Disk Usage

Network Throughput

Filesystem Usage

Database Connections
```

---

### Application Metrics

```text
HTTP Requests

API Latency

Request Duration

Error Rate

Authentication Requests

Queue Length

Background Jobs

Cache Hit Ratio
```

---

### Database Metrics

```text
Query Duration

Active Sessions

Locks

Deadlocks

Replication Lag

Transaction Rate

Index Usage

Sequential Scans
```

---

### Business Metrics

```text
Orders Created

Invoices Posted

Production Batches

Inventory Movements

Revenue

Expenses

Payments

Deliveries
```

Business metrics SHALL remain available for dashboard visualization.

---

# Logging Strategy

The application SHALL produce structured logs.

Recommended format:

```json
{
  "timestamp": "...",
  "level": "...",
  "service": "...",
  "request_id": "...",
  "tenant_id": "...",
  "user_id": "...",
  "message": "...",
  "metadata": {}
}
```

Plain text logs SHOULD be avoided.

---

# Log Levels

Supported log levels:

```text
TRACE

DEBUG

INFO

WARN

ERROR

FATAL
```

Production environments SHOULD disable verbose debugging.

---

# Centralized Log Collection

Logs SHOULD be aggregated into a centralized platform.

Examples:

```text
OpenSearch

Elastic

Grafana Loki

Cloud Logging
```

Local log files SHALL not be the primary operational source.

---

# Log Retention

Recommended retention:

| Log Type | Retention |
|----------|-----------|
| Application | 90 Days |
| Audit | 7 Years |
| Security | 7 Years |
| Access | 1 Year |
| Debug | 14 Days |

Retention SHALL comply with applicable regulations.

---

# Distributed Tracing

Every request SHOULD generate:

```text
Trace ID

↓

Span ID

↓

Request ID
```

Tracing SHALL support:

- API Requests
- Database Queries
- Background Jobs
- External APIs
- Notification Delivery

---

# Monitoring Dashboards

Operational dashboards SHOULD include:

### Infrastructure Dashboard

```text
CPU

Memory

Storage

Network

Database
```

---

### API Dashboard

```text
Requests

Latency

Error %

Response Time

Active Users
```

---

### Database Dashboard

```text
Connections

Transactions

Locks

Slow Queries

Replication

Cache Hit Ratio
```

---

### Business Dashboard

```text
Sales

Orders

Inventory

Production

Finance

Employees
```

---

# Alert Categories

Alerts SHALL be classified as:

```text
Information

Warning

Critical

Emergency
```

Severity SHALL determine escalation.

---

# Recommended Alert Thresholds

Examples:

| Metric | Threshold |
|---------|-----------|
| CPU Usage | >85% |
| Memory Usage | >90% |
| Disk Usage | >80% |
| Error Rate | >5% |
| API Latency | >1000ms |
| Database Connections | >90% |
| Replication Lag | >30 Seconds |

Organizations MAY customize thresholds.

---

# Incident Response

Every production incident SHOULD follow:

```text
Detection

↓

Classification

↓

Assignment

↓

Mitigation

↓

Resolution

↓

Root Cause Analysis

↓

Postmortem
```

Every critical incident SHALL receive documentation.

---

# Operational Runbooks

Runbooks SHOULD exist for:

- Database Failure
- Authentication Failure
- Storage Failure
- Notification Failure
- Payment Gateway Failure
- Queue Failure
- Replication Failure
- High CPU Usage
- High Memory Usage
- Slow Queries

Runbooks SHALL remain version controlled.

---

# Performance Monitoring

Continuous monitoring SHALL track:

```text
P50 Response Time

P95 Response Time

P99 Response Time

Average Query Time

Slow Queries

Cache Hit Ratio
```

Performance regressions SHALL trigger alerts.

---

# Slow Query Detection

Queries exceeding:

```text
500ms
```

SHOULD be logged.

Queries exceeding:

```text
2 Seconds
```

SHALL generate alerts.

---

# Capacity Planning

Capacity reports SHOULD include:

- Storage Growth
- User Growth
- Transaction Growth
- Database Size
- Queue Growth
- API Traffic
- Peak Load
- Backup Size

Planning SHOULD occur quarterly.

---

# Maintenance Schedule

Recommended operational maintenance:

| Activity | Frequency |
|----------|-----------|
| Vacuum Analyze | Weekly |
| Index Review | Monthly |
| Backup Restore Test | Monthly |
| Secret Rotation | Quarterly |
| Dependency Updates | Monthly |
| Performance Review | Monthly |
| Security Review | Quarterly |

---

# Security Monitoring

Monitor events including:

```text
Failed Logins

Permission Changes

API Key Usage

RLS Violations

Privilege Escalation

Suspicious Requests

Rate Limit Violations
```

Security anomalies SHALL generate immediate alerts.

---

# Service Level Objectives (SLOs)

Recommended targets:

| Service | Target |
|----------|--------|
| API Availability | 99.9% |
| Authentication | 99.95% |
| Database | 99.95% |
| Notification Queue | 99.5% |
| Reporting | 99.5% |

Service Level Indicators (SLIs) SHALL be continuously measured.

---

# Operational Checklist

Operations SHALL regularly verify:

- Monitoring active.
- Alerts operational.
- Dashboards accessible.
- Logs retained.
- Traces collected.
- Backups successful.
- Queues healthy.
- Replication synchronized.
- Certificates valid.
- Secrets rotated.

---

# Validation Checklist

The Observability & Operations module SHALL verify:

- Metrics collected.
- Structured logging implemented.
- Distributed tracing enabled.
- Centralized logging configured.
- Dashboards available.
- Alert thresholds defined.
- Incident response documented.
- Runbooks maintained.
- Performance monitored.
- Capacity planning established.

The Observability & Operations module SHALL be completed before implementing Performance Optimization, Security Hardening, Final Architecture Validation, and Release Certification.

---

END OF CHUNK 28/42

Next:

Chunk 29/42 — Performance Optimization, Scalability & Enterprise Architecture (Scalability Strategy, Horizontal Scaling, Caching, Database Optimization, Enterprise Readiness)

Append this chunk immediately below Chunk 28/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
29/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 28/42

Status:
Continuation

========================================

# Performance Optimization, Scalability & Enterprise Architecture

## Purpose

This section defines BakeFlow's enterprise scalability strategy.

The platform SHALL scale from:

- Single Bakery
- Multi-Branch Business
- Regional Enterprise
- National Franchise
- International Organization

without requiring architectural redesign.

Scalability SHALL be considered during every implementation decision.

---

# Scalability Architecture

```text
Mobile Apps

↓

API Gateway

↓

Application Services

↓

Cache Layer

↓

Database

↓

Read Replicas

↓

Analytics
```

Every layer SHALL scale independently.

---

# Scaling Philosophy

BakeFlow SHALL prioritize:

```text
Vertical Scaling

↓

Horizontal Scaling

↓

Distributed Services
```

The architecture SHALL support gradual evolution.

---

# Stateless Application Design

Application services SHALL remain stateless.

Persistent information SHALL reside in:

```text
Database

↓

Storage

↓

Cache

↓

Message Queue
```

Stateless services simplify horizontal scaling.

---

# Horizontal Scaling

Application servers SHALL support:

```text
1

↓

2

↓

4

↓

8

↓

N

Instances
```

Requests SHALL distribute through a load balancer.

---

# Load Balancing

Recommended load balancing strategy:

```text
Client

↓

Load Balancer

↓

API Node 1

API Node 2

API Node 3
```

Sticky sessions SHOULD NOT be required.

---

# Database Scaling

Database scaling SHALL occur through:

```text
Primary Database

↓

Read Replicas

↓

Reporting Database
```

Write operations SHALL remain centralized.

---

# Read Replica Usage

Read replicas SHOULD handle:

- Dashboards
- Analytics
- Reporting
- Search
- Historical Queries

Transactional operations SHALL always use the primary database.

---

# Connection Pooling

Every deployment SHALL implement connection pooling.

Recommended configuration:

```text
Application

↓

PgBouncer

↓

PostgreSQL
```

Pooling SHALL reduce connection overhead.

---

# Caching Strategy

Caching SHALL exist at multiple layers.

---

## Client Cache

Examples:

```text
Product Lists

Settings

Permissions

Profile
```

---

## API Cache

Examples:

```text
Dashboard Data

Reference Data

Configuration

Exchange Rates
```

---

## Database Cache

Materialized Views SHALL support:

- Reporting
- Analytics
- Executive Dashboards

---

## CDN Cache

Static assets SHOULD use:

```text
Images

Documents

Icons

Application Assets
```

---

# Cache Expiration

Recommended cache durations:

| Data | Cache Duration |
|------|----------------|
| Products | 15 Minutes |
| Dashboard | 5 Minutes |
| Configuration | 1 Hour |
| Reports | 15 Minutes |
| Static Assets | 24 Hours |

Organizations MAY customize durations.

---

# Background Processing

Long-running work SHALL execute asynchronously.

Examples:

```text
Report Generation

Email Delivery

Notification Processing

AI Analysis

Inventory Rebuild

Dashboard Refresh
```

Users SHOULD never wait for lengthy processing.

---

# Queue Architecture

Recommended workflow:

```text
Application

↓

Job Queue

↓

Worker

↓

Database

↓

Notification
```

Workers SHALL scale independently.

---

# Storage Scalability

File storage SHALL support:

```text
Images

Invoices

Receipts

Exports

Reports

Employee Documents
```

Object storage SHALL be preferred over filesystem storage.

---

# Database Partitioning

Very large tables MAY implement partitioning.

Recommended candidates:

```text
audit_log

journal_line

inventory_movement

notification_delivery_log

background_job_log
```

Partitioning MAY occur by:

- Date
- Organization
- Fiscal Year

---

# Archive Strategy

Historical records SHOULD transition to archive storage.

Examples:

```text
Completed Orders

Old Notifications

Historical Logs

Archived Reports
```

Archived data SHALL remain searchable.

---

# Query Optimization Standards

Application queries SHALL:

- Use indexes.
- Paginate results.
- Minimize joins.
- Avoid N+1 queries.
- Prefer prepared statements.
- Limit returned columns.

Database performance SHALL remain measurable.

---

# API Performance Targets

Recommended response times:

| Endpoint | Target |
|-----------|---------|
| Authentication | <300 ms |
| Dashboard | <500 ms |
| Inventory Search | <250 ms |
| Customer Search | <250 ms |
| Reports | <3 Seconds |
| Analytics | <5 Seconds |

These values SHOULD be monitored continuously.

---

# Mobile Performance

Mobile applications SHOULD:

- Cache offline data.
- Lazy load lists.
- Paginate large datasets.
- Compress images.
- Minimize network requests.
- Synchronize incrementally.

Offline capability SHALL remain a primary design goal.

---

# Multi-Organization Scaling

The architecture SHALL support:

```text
Organization A

Organization B

Organization C

...

Organization N
```

without performance degradation caused by tenant growth.

---

# Enterprise Features

Enterprise deployments MAY enable:

- Multiple Regions
- Multiple Currencies
- Multiple Languages
- Multiple Tax Jurisdictions
- Regional Warehouses
- Centralized Reporting

The core architecture SHALL remain unchanged.

---

# Capacity Planning

Quarterly planning SHOULD evaluate:

- User Growth
- Database Size
- Storage Usage
- API Throughput
- Queue Length
- Reporting Volume
- Backup Size

Infrastructure SHALL scale before resource exhaustion.

---

# Resource Limits

Recommended operational thresholds:

| Resource | Target |
|-----------|---------|
| CPU | <70% Average |
| Memory | <75% Average |
| Database Connections | <80% |
| Storage | <75% |
| Queue Backlog | <10 Minutes |

Thresholds SHALL trigger proactive alerts.

---

# Enterprise Deployment Model

Large deployments MAY implement:

```text
Global Load Balancer

↓

Regional API Cluster

↓

Regional Database Replica

↓

Central Primary Database

↓

Analytics Cluster
```

Regional expansion SHALL not require application redesign.

---

# Scalability Testing

Regular testing SHOULD include:

- Load Testing
- Stress Testing
- Spike Testing
- Endurance Testing
- Failover Testing

Performance bottlenecks SHALL be documented and resolved.

---

# Validation Checklist

The Performance & Scalability module SHALL verify:

- Stateless application architecture.
- Horizontal scaling supported.
- Read replicas configured.
- Connection pooling enabled.
- Multi-layer caching implemented.
- Background processing isolated.
- Database partitioning strategy defined.
- Mobile performance optimized.
- Enterprise scaling supported.
- Capacity planning established.

The Performance & Scalability module SHALL be completed before implementing Security Hardening, Architecture Validation, Production Certification, and Final Release Documentation.

---

END OF CHUNK 29/42

Next:

Chunk 30/42 — Security Hardening, Compliance & Enterprise Security Standards (Application Security, Encryption, Compliance, Vulnerability Management, Penetration Testing, Secure Operations)

Append this chunk immediately below Chunk 29/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
30/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 29/42

Status:
Continuation

========================================

# Security Hardening, Compliance & Enterprise Security Standards

## Purpose

This section defines BakeFlow's enterprise security architecture.

Security SHALL be implemented as a layered defense strategy protecting:

- Customer Data
- Financial Records
- Production Data
- Employee Information
- Authentication
- Infrastructure
- APIs
- Mobile Applications

Security SHALL be integrated into every component of the platform.

---

# Security Architecture

```text
User

↓

Authentication

↓

Authorization

↓

API Security

↓

Application Security

↓

Database Security

↓

Infrastructure Security

↓

Monitoring

↓

Audit
```

Each layer SHALL remain independently enforceable.

---

# Defense in Depth

BakeFlow SHALL implement:

```text
Network Security

↓

Infrastructure Security

↓

Application Security

↓

Database Security

↓

Data Encryption

↓

Monitoring

↓

Incident Response
```

No single security control SHALL be relied upon exclusively.

---

# Authentication Standards

Authentication SHALL support:

- Email & Password
- Magic Links
- OAuth Providers
- Multi-Factor Authentication (MFA)
- Session Management
- Device Recognition

Authentication SHALL be delegated to Supabase Auth.

---

# Password Requirements

Where passwords are used:

Minimum requirements:

```text
12 Characters

Uppercase

Lowercase

Number

Special Character
```

Passwords SHALL never be stored by the application.

---

# Multi-Factor Authentication

Organizations SHOULD enable MFA.

Supported methods:

```text
Authenticator Apps

TOTP

Email Verification

Future:

Passkeys

Hardware Keys
```

MFA SHALL be mandatory for privileged accounts.

---

# Session Security

Sessions SHALL support:

- Secure JWTs
- Refresh Tokens
- Session Expiration
- Device Revocation
- Concurrent Session Management

Idle sessions SHOULD automatically expire.

---

# Authorization Model

BakeFlow SHALL implement:

```text
Authentication

+

RBAC

+

Permissions

+

Row-Level Security
```

Authorization SHALL be enforced server-side.

---

# API Security

Every API SHALL enforce:

- HTTPS
- JWT Validation
- Request Validation
- Rate Limiting
- CORS Policies
- Input Sanitization

Unauthenticated requests SHALL be rejected unless explicitly public.

---

# Rate Limiting

Recommended limits:

| Endpoint | Limit |
|-----------|--------|
| Authentication | 10/minute |
| API Requests | 300/minute |
| File Uploads | 30/hour |
| Password Reset | 5/hour |
| OTP Requests | 10/hour |

Organizations MAY configure stricter limits.

---

# Encryption Standards

Data SHALL be protected:

### In Transit

```text
TLS 1.2+

HTTPS Only
```

---

### At Rest

```text
AES-256
```

Applied to:

- Database Storage
- Object Storage
- Backups
- Secrets

---

### Application Secrets

Secrets SHALL remain encrypted.

Examples:

```text
SMTP Credentials

OAuth Tokens

Webhook Secrets

API Keys

Encryption Keys
```

---

# Sensitive Data Classification

BakeFlow SHALL classify data:

### Public

```text
Marketing

Documentation
```

---

### Internal

```text
Configuration

Reports
```

---

### Confidential

```text
Customers

Employees

Suppliers
```

---

### Restricted

```text
Passwords

API Keys

Tokens

Financial Data

Payroll
```

Restricted data SHALL receive the highest protection.

---

# Database Security

The database SHALL enforce:

- Row-Level Security
- Least Privilege
- Secure Functions
- Encrypted Connections
- Audit Logging

Direct database access SHALL remain restricted.

---

# Secret Management

Secrets SHALL NEVER be:

- Hardcoded.
- Committed to Git.
- Logged.
- Sent to clients.

Secrets SHOULD reside within:

```text
Supabase Secrets

Cloud Secret Manager

GitHub Secrets
```

---

# Dependency Management

All dependencies SHALL undergo:

- Vulnerability Scanning
- License Review
- Version Tracking
- Automated Updates

Critical vulnerabilities SHALL be remediated immediately.

---

# Secure Coding Standards

Developers SHALL:

- Validate input.
- Sanitize output.
- Use parameterized queries.
- Avoid dynamic SQL.
- Prevent injection attacks.
- Handle errors securely.
- Protect against mass assignment.

Security SHALL be incorporated during development rather than added later.

---

# OWASP Top 10 Protection

BakeFlow SHALL mitigate:

- Broken Access Control
- Cryptographic Failures
- Injection
- Insecure Design
- Security Misconfiguration
- Vulnerable Components
- Authentication Failures
- Software Integrity Failures
- Logging Failures
- Server-Side Request Forgery (SSRF)

Security reviews SHALL verify these controls.

---

# Compliance

The platform SHOULD support:

```text
GDPR

CCPA

PCI DSS (where applicable)

ISO 27001 Practices
```

Compliance requirements MAY vary by deployment region.

---

# Privacy Controls

Users SHOULD be able to:

- Access personal data.
- Export personal data.
- Correct personal data.
- Request deletion (where legally permitted).

Privacy requests SHALL be auditable.

---

# Security Monitoring

Monitor events including:

```text
Failed Logins

Permission Changes

Suspicious API Usage

Privilege Escalation

RLS Violations

Credential Rotation

Webhook Failures
```

Critical events SHALL trigger immediate alerts.

---

# Vulnerability Management

Security reviews SHOULD include:

- Static Analysis
- Dependency Scanning
- Container Scanning
- Secret Scanning
- Infrastructure Scanning

Critical findings SHALL block production releases.

---

# Penetration Testing

Recommended schedule:

| Assessment | Frequency |
|------------|-----------|
| Internal Security Review | Quarterly |
| Vulnerability Scan | Monthly |
| External Penetration Test | Annually |
| Infrastructure Review | Annually |

Major architectural changes SHOULD trigger additional testing.

---

# Incident Response

Security incidents SHALL follow:

```text
Detection

↓

Containment

↓

Investigation

↓

Eradication

↓

Recovery

↓

Lessons Learned
```

Every incident SHALL produce a documented postmortem.

---

# Security Audit Checklist

Regular audits SHALL verify:

- MFA enabled.
- Secrets rotated.
- Dependencies updated.
- RLS active.
- Audit logging operational.
- TLS certificates valid.
- Backups encrypted.
- API rate limits enforced.
- Vulnerabilities resolved.
- Monitoring active.

---

# Validation Checklist

The Security Hardening module SHALL verify:

- Layered security implemented.
- MFA supported.
- Strong authentication enforced.
- Authorization server-side.
- Encryption applied.
- Secrets protected.
- OWASP controls implemented.
- Compliance supported.
- Vulnerability management operational.
- Incident response documented.

The Security Hardening module SHALL be completed before implementing Final Architecture Validation, System Certification, Production Readiness Review, and Release Approval.

---

END OF CHUNK 30/42

Next:

Chunk 31/42 — Final Architecture Validation, Quality Assurance & System Certification (Architecture Review, Validation Matrix, Quality Gates, Acceptance Criteria, Enterprise Readiness)

Append this chunk immediately below Chunk 30/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
31/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 30/42

Status:
Continuation

========================================

# Final Architecture Validation, Quality Assurance & System Certification

## Purpose

This section defines the final validation process required before BakeFlow is approved for production deployment.

Every subsystem SHALL successfully complete technical, operational, security, and business validation.

Production deployment SHALL NOT occur until all mandatory quality gates have passed.

---

# Certification Architecture

```text
Architecture Review

↓

Database Validation

↓

Application Validation

↓

Security Validation

↓

Performance Validation

↓

Business Validation

↓

Production Readiness

↓

Release Approval
```

Every phase SHALL produce verifiable evidence.

---

# Architecture Validation

The architecture review SHALL verify:

- Modular architecture
- Separation of concerns
- Multi-tenant isolation
- Scalability
- Fault tolerance
- Maintainability
- Security boundaries
- Performance objectives

No critical architectural deficiencies SHALL remain.

---

# Database Validation

The database SHALL verify:

```text
Tables

Relationships

Constraints

Indexes

Triggers

Functions

Views

Materialized Views

RLS Policies
```

All database migrations SHALL execute successfully on a clean environment.

---

# Application Validation

Every application module SHALL be tested.

Required modules:

```text
Authentication

Organization Management

Employee Management

Customer Management

Supplier Management

Inventory

Production

Sales

Purchasing

Finance

Payroll

Reporting

Notifications

Dashboard

Administration
```

Every module SHALL satisfy its documented requirements.

---

# API Validation

Every API SHALL verify:

- Authentication
- Authorization
- Request Validation
- Response Validation
- Error Handling
- Pagination
- Filtering
- Rate Limiting

API contracts SHALL remain versioned.

---

# Mobile Validation

The mobile application SHALL verify:

- Authentication
- Offline Mode
- Synchronization
- Push Notifications
- Camera
- Barcode Scanning
- Printing
- File Uploads
- Performance

Target devices SHALL include:

- Android Phones
- Android Tablets

Future iOS support SHALL remain compatible.

---

# Security Validation

Security review SHALL verify:

- MFA
- JWT Validation
- RLS
- Encryption
- API Security
- Secret Management
- OWASP Protection
- Audit Logging
- Rate Limiting
- Session Security

No Critical or High severity vulnerabilities SHALL remain unresolved.

---

# Performance Validation

Performance testing SHALL verify:

| Component | Target |
|-----------|---------|
| Authentication | <300 ms |
| Dashboard | <500 ms |
| Inventory Search | <250 ms |
| Customer Search | <250 ms |
| Sales Posting | <500 ms |
| Production Posting | <1 Second |
| Financial Posting | <1 Second |
| Reports | <3 Seconds |

Performance SHALL remain acceptable under expected production load.

---

# Scalability Validation

Testing SHALL confirm support for:

```text
Multiple Organizations

↓

Multiple Branches

↓

Concurrent Users

↓

Large Datasets

↓

Background Workers
```

Scalability SHALL not require architectural modification.

---

# Reliability Validation

System reliability SHALL verify:

- Automatic Recovery
- Retry Logic
- Queue Recovery
- Backup Success
- Restore Success
- Replication
- Failover
- Monitoring

Recovery procedures SHALL be documented.

---

# Data Integrity Validation

Verification SHALL include:

- Foreign Keys
- Check Constraints
- Unique Constraints
- Financial Balancing
- Inventory Accuracy
- Production Accuracy
- Audit Consistency

Database consistency SHALL remain intact after all automated tests.

---

# Business Workflow Validation

The following end-to-end workflows SHALL be tested:

```text
Customer Registration

↓

Quotation

↓

Sales Order

↓

Production

↓

Inventory Consumption

↓

Invoice

↓

Payment

↓

Accounting

↓

Reporting
```

---

Additional workflows:

```text
Purchase Request

↓

Purchase Order

↓

Goods Receipt

↓

Supplier Invoice

↓

Supplier Payment

↓

Financial Posting
```

---

# Financial Validation

Finance SHALL verify:

- Trial Balance
- General Ledger
- Income Statement
- Balance Sheet
- Cash Flow
- Budget Variance
- Journal Posting
- Journal Reversal

Financial statements SHALL reconcile.

---

# Inventory Validation

Inventory SHALL verify:

- Stock Movements
- Reservations
- Transfers
- Adjustments
- Valuation
- Production Consumption
- Finished Goods Posting

Negative inventory SHALL only occur where explicitly permitted.

---

# Production Validation

Production SHALL verify:

- Recipe Scaling
- Ingredient Consumption
- Batch Completion
- Waste Recording
- Yield Calculation
- Cost Allocation

Production cost SHALL reconcile with financial postings.

---

# Reporting Validation

Reports SHALL verify:

- Accuracy
- Performance
- Export
- Filters
- Security
- Historical Reporting

Materialized views SHALL refresh correctly.

---

# Disaster Recovery Validation

Recovery testing SHALL verify:

- Backup Restore
- PITR
- Failover
- Read Replica Promotion
- Recovery Documentation

Recovery objectives SHALL be achieved.

---

# User Acceptance Testing (UAT)

Representative users SHALL validate:

- Bakery Owner
- Branch Manager
- Cashier
- Production Staff
- Driver
- Accountant
- Administrator

Business acceptance SHALL precede production deployment.

---

# Quality Gates

Release SHALL require successful completion of:

| Gate | Required |
|-------|----------|
| Unit Tests | Yes |
| Integration Tests | Yes |
| Database Validation | Yes |
| Security Review | Yes |
| Performance Testing | Yes |
| UAT | Yes |
| Backup Verification | Yes |
| Production Readiness Review | Yes |

Failure of any mandatory gate SHALL block release.

---

# Production Readiness Review

The review SHALL verify:

- Infrastructure deployed.
- Monitoring operational.
- Alerts configured.
- Secrets configured.
- Backups verified.
- RLS enabled.
- Security approved.
- Documentation complete.
- Support team prepared.
- Rollback plan available.

---

# Release Approval

Final approval SHOULD include:

- Product Owner
- Technical Lead
- Security Lead
- Database Architect
- Operations Lead

Approval SHALL be documented.

---

# Enterprise Certification Checklist

The platform SHALL verify:

- Enterprise scalability.
- Multi-tenant security.
- Financial accuracy.
- Operational stability.
- Disaster recovery.
- Regulatory readiness.
- Performance objectives.
- Security hardening.
- Production readiness.
- Documentation completeness.

---

# Validation Checklist

The Final Architecture Validation module SHALL verify:

- Architecture approved.
- Database validated.
- APIs verified.
- Mobile application tested.
- Financial reconciliation complete.
- Security approved.
- Performance targets achieved.
- UAT completed.
- Production readiness confirmed.
- Release approval documented.

Successful completion of this module SHALL authorize progression to Final Documentation, Operational Handover, Long-Term Maintenance Planning, and System Release Certification.

---

END OF CHUNK 31/42

Next:

Chunk 32/42 — Documentation Standards, Developer Handover & Long-Term Maintenance (Documentation Structure, Code Standards, Operational Handover, Knowledge Transfer, Maintenance Strategy)

Append this chunk immediately below Chunk 31/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
32/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 31/42

Status:
Continuation

========================================

# Documentation Standards, Developer Handover & Long-Term Maintenance

## Purpose

This section defines BakeFlow's documentation, developer onboarding, operational handover, and long-term maintenance standards.

The objective is to ensure the platform remains maintainable regardless of team size or future ownership.

Documentation SHALL be treated as part of the product.

---

# Documentation Philosophy

Every architectural decision SHALL be documented.

Documentation SHALL be:

- Accurate
- Version Controlled
- Searchable
- Reviewable
- Continuously Updated

Undocumented functionality SHALL be considered incomplete.

---

# Documentation Hierarchy

Recommended structure:

```text
Engineering Bible

↓

Architecture Documents

↓

Database Documentation

↓

API Documentation

↓

Frontend Documentation

↓

Deployment Documentation

↓

Operations Documentation

↓

User Documentation
```

Each layer SHALL reference higher-level documentation where appropriate.

---

# Repository Structure

Recommended repository organization:

```text
/docs

    architecture/

    database/

    api/

    frontend/

    backend/

    deployment/

    operations/

    security/

    testing/

    user-guides/
```

Documentation SHALL reside alongside source code.

---

# Required Architecture Documents

The following SHALL exist:

- System Overview
- Domain Architecture
- Database Design
- API Specification
- Authentication Flow
- Authorization Model
- Integration Architecture
- Infrastructure Architecture
- Deployment Strategy
- Disaster Recovery Plan

---

# API Documentation

Every API endpoint SHALL document:

- Endpoint
- Method
- Authentication
- Request Schema
- Response Schema
- Error Responses
- Rate Limits
- Examples

OpenAPI (Swagger) SHALL be maintained.

---

# Database Documentation

Database documentation SHALL include:

- Entity Relationship Diagram
- Table Definitions
- Constraints
- Indexes
- Functions
- Triggers
- Views
- Materialized Views
- RLS Policies

Documentation SHALL remain synchronized with migrations.

---

# Code Documentation

Public classes and reusable functions SHOULD include:

- Purpose
- Parameters
- Return Values
- Exceptions
- Examples

Business-critical logic SHALL always be documented.

---

# Coding Standards

Development SHALL follow consistent standards.

Examples:

```text
Consistent Naming

Modular Design

Small Functions

Single Responsibility

Reusable Components

Minimal Duplication
```

Code reviews SHALL verify adherence.

---

# Naming Conventions

Recommended standards:

| Object | Convention |
|----------|------------|
| Tables | snake_case |
| Columns | snake_case |
| Functions | snake_case |
| Components | PascalCase |
| Variables | camelCase |
| Constants | UPPER_SNAKE_CASE |
| Files | kebab-case or PascalCase (framework appropriate) |

Naming SHALL remain predictable.

---

# Commenting Guidelines

Comments SHOULD explain:

```text
WHY
```

rather than:

```text
WHAT
```

Self-explanatory code SHALL be preferred.

Outdated comments SHALL be removed.

---

# Version Control Standards

Every commit SHOULD:

- Be atomic.
- Address one logical change.
- Pass validation.
- Reference related issues.

Commit messages SHOULD remain descriptive.

Example:

```text
feat(finance):

implement journal posting validation
```

---

# Pull Request Requirements

Every Pull Request SHALL include:

- Summary
- Linked Issue
- Screenshots (UI changes)
- Migration Notes
- Testing Evidence
- Rollback Considerations

Code SHALL not merge without review.

---

# Code Review Checklist

Reviewers SHALL verify:

- Correctness
- Maintainability
- Security
- Performance
- Readability
- Test Coverage
- Documentation
- Error Handling

All review comments SHALL be resolved before merge.

---

# Developer Onboarding

New developers SHOULD receive:

- Engineering Bible
- Architecture Overview
- Repository Access
- Development Environment Setup
- Coding Standards
- Branch Strategy
- Deployment Process

Onboarding SHALL be documented.

---

# Environment Setup Guide

Documentation SHALL explain:

- Required Software
- Dependencies
- Environment Variables
- Local Supabase Setup
- Running Migrations
- Running Tests
- Debugging

Setup SHOULD require minimal manual configuration.

---

# Knowledge Transfer

Knowledge transfer SHALL include:

- Live Demonstrations
- Architecture Walkthroughs
- Database Overview
- API Overview
- Deployment Process
- Operational Procedures

Critical knowledge SHALL never exist only in verbal form.

---

# Operational Handover

Operations documentation SHALL include:

- Deployment Procedures
- Rollback Procedures
- Monitoring Dashboards
- Incident Response
- Backup Procedures
- Restore Procedures
- Contact Information

Operations SHALL be able to maintain the system independently.

---

# Maintenance Strategy

Long-term maintenance SHALL include:

- Dependency Updates
- Security Updates
- Performance Reviews
- Database Optimization
- Documentation Updates
- Infrastructure Reviews

Preventive maintenance SHALL occur regularly.

---

# Technical Debt Management

Technical debt SHALL be:

- Identified
- Prioritized
- Documented
- Scheduled

Known technical debt SHALL never remain hidden.

---

# Documentation Review Cycle

Recommended review schedule:

| Documentation | Frequency |
|---------------|-----------|
| Architecture | Quarterly |
| API | Every Release |
| Database | Every Migration |
| Operations | Quarterly |
| Security | Quarterly |
| User Guides | Every Feature Release |

Documentation SHALL evolve with the system.

---

# Support Documentation

Support teams SHOULD receive:

- Troubleshooting Guides
- Common Error Catalog
- Recovery Procedures
- FAQ
- Escalation Paths
- Customer Support Workflows

Support documentation SHALL reduce operational delays.

---

# Project Completion Checklist

Project documentation SHALL verify:

- Architecture documented.
- Database documented.
- APIs documented.
- Infrastructure documented.
- Security documented.
- Deployment documented.
- Operations documented.
- User guides completed.
- Maintenance plan documented.
- Knowledge transfer completed.

---

# Validation Checklist

The Documentation & Handover module SHALL verify:

- Documentation hierarchy established.
- Repository documentation organized.
- API documentation complete.
- Database documentation complete.
- Coding standards defined.
- Review process documented.
- Developer onboarding complete.
- Operations handover completed.
- Maintenance strategy established.
- Knowledge transfer completed.

The Documentation & Handover module SHALL be completed before Final Release Management, Product Lifecycle Governance, and Engineering Bible Certification.

---

END OF CHUNK 32/42

Next:

Chunk 33/42 — Release Management, Versioning & Product Lifecycle Governance (Release Process, Semantic Versioning, Change Management, Deprecation Policy, End-of-Life Strategy)

Append this chunk immediately below Chunk 32/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
33/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 32/42

Status:
Continuation

========================================

# Release Management, Versioning & Product Lifecycle Governance

## Purpose

This section defines BakeFlow's release governance framework.

The objective is to ensure every software release is:

- Predictable
- Traceable
- Reproducible
- Stable
- Auditable
- Recoverable

Release Management SHALL govern the complete lifecycle from development through retirement.

---

# Product Lifecycle

BakeFlow SHALL progress through the following lifecycle:

```text
Planning

↓

Design

↓

Development

↓

Testing

↓

Staging

↓

Production

↓

Maintenance

↓

Enhancement

↓

Retirement
```

Every stage SHALL have defined entry and exit criteria.

---

# Release Types

BakeFlow SHALL support three release categories.

## Major Release

Examples:

```text
1.0.0

2.0.0

3.0.0
```

Characteristics:

- Breaking changes
- New architecture
- Major functionality
- Database upgrades

---

## Minor Release

Examples:

```text
2.1.0

2.2.0

2.3.0
```

Characteristics:

- New features
- Backward compatible
- Performance improvements

---

## Patch Release

Examples:

```text
2.2.1

2.2.2

2.2.3
```

Characteristics:

- Bug fixes
- Security fixes
- Small improvements

Patch releases SHALL avoid breaking changes.

---

# Semantic Versioning

BakeFlow SHALL follow:

```text
MAJOR.MINOR.PATCH
```

Meaning:

```text
2

Major Version

.

4

Minor Version

.

7

Patch Version
```

Version numbers SHALL accurately represent compatibility.

---

# Database Versioning

Database schema SHALL maintain an independent version.

Example:

| Application | Database |
|-------------|----------|
| 2.3.0 | Schema v15 |
| 2.4.0 | Schema v16 |
| 3.0.0 | Schema v20 |

Application and schema compatibility SHALL be documented.

---

# Release Branch Strategy

Recommended Git branches:

```text
main

↓

release/*

↓

develop

↓

feature/*
```

Emergency fixes MAY use:

```text
hotfix/*
```

All release branches SHALL remain protected.

---

# Change Management

Every change SHALL include:

- Business Justification
- Technical Design
- Risk Assessment
- Testing Evidence
- Rollback Plan
- Deployment Notes

Changes SHALL receive appropriate approvals.

---

# Change Classification

Recommended categories:

```text
Low Risk

↓

Medium Risk

↓

High Risk

↓

Critical
```

Higher-risk changes SHALL require additional review.

---

# Release Checklist

Every release SHALL verify:

- Features complete.
- Tests passing.
- Documentation updated.
- Migrations validated.
- Security reviewed.
- Performance verified.
- Monitoring configured.
- Rollback documented.

No release SHALL bypass mandatory validation.

---

# Release Notes

Every release SHALL publish:

- New Features
- Improvements
- Bug Fixes
- Security Updates
- Known Issues
- Upgrade Instructions
- Database Changes

Release notes SHALL remain permanently available.

---

# Feature Flags

New functionality SHOULD support feature flags.

Benefits:

- Controlled rollout
- Canary testing
- Fast rollback
- Incremental adoption

Feature flags SHALL be removable after stabilization.

---

# Deployment Approval Workflow

Recommended approval sequence:

```text
Developer

↓

Technical Review

↓

QA Approval

↓

Security Review

↓

Operations Approval

↓

Production Deployment
```

Emergency releases MAY follow an expedited process with retrospective review.

---

# Rollback Governance

Rollback SHALL be initiated when:

- Critical defects discovered.
- Security vulnerabilities identified.
- Data integrity compromised.
- Performance degradation exceeds thresholds.

Rollback decisions SHALL be documented.

---

# Hotfix Procedure

Critical production defects SHALL follow:

```text
Issue Identified

↓

Incident Declared

↓

Hotfix Branch

↓

Testing

↓

Approval

↓

Deployment

↓

Verification

↓

Merge Back
```

Hotfixes SHALL be incorporated into ongoing development.

---

# Deprecation Policy

Deprecated functionality SHALL:

- Be documented.
- Generate warnings where appropriate.
- Remain supported for a defined period.
- Include migration guidance.

Unexpected removal SHALL be avoided.

---

# End-of-Life (EOL) Strategy

Retired features SHALL follow:

```text
Announcement

↓

Deprecation

↓

Migration Period

↓

Removal

↓

Documentation Archive
```

Organizations SHALL receive advance notice before removal.

---

# Long-Term Support (LTS)

Selected releases MAY become Long-Term Support versions.

Typical characteristics:

- Security updates only.
- Critical bug fixes.
- Extended maintenance window.

LTS versions SHALL be clearly identified.

---

# Compatibility Policy

Backward compatibility SHALL be maintained whenever practical.

Breaking changes SHALL require:

- Major version increment.
- Migration documentation.
- Upgrade testing.

---

# Release Metrics

Each release SHOULD track:

- Deployment Duration
- Rollback Rate
- Defect Escape Rate
- Mean Time to Recovery (MTTR)
- Customer Impact
- Incident Count

Metrics SHALL support continuous improvement.

---

# Governance Responsibilities

Release governance SHOULD involve:

- Product Owner
- Engineering Lead
- QA Lead
- Security Lead
- Operations Lead

Responsibilities SHALL be documented.

---

# Documentation Requirements

Each release SHALL update:

- Engineering Bible
- API Documentation
- Database Documentation
- User Documentation
- Operations Guide
- Release Notes
- Migration Guide

Documentation SHALL remain synchronized with the released software.

---

# Validation Checklist

The Release Management module SHALL verify:

- Semantic versioning implemented.
- Database versioning tracked.
- Branch strategy documented.
- Change management established.
- Release checklist enforced.
- Release notes published.
- Feature flags supported.
- Rollback procedures documented.
- Deprecation policy defined.
- Product lifecycle governed.

The Release Management module SHALL be completed before Final Engineering Bible Certification, Enterprise Readiness Assessment, and Official BakeFlow v1.0 Architecture Sign-off.

---

END OF CHUNK 33/42

Next:

Chunk 34/42 — Enterprise Readiness Assessment & Operational Excellence Framework (Operational Maturity, Enterprise Capability Matrix, Risk Assessment, Governance, Continuous Improvement)

Append this chunk immediately below Chunk 33/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
34/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 33/42

Status:
Continuation

========================================

# Enterprise Readiness Assessment & Operational Excellence Framework

## Purpose

This section defines the framework used to evaluate whether BakeFlow is ready for enterprise-scale deployment.

Enterprise readiness extends beyond software functionality and includes operational maturity, governance, scalability, resilience, security, maintainability, and continuous improvement.

An enterprise-ready platform SHALL consistently satisfy technical and business objectives.

---

# Enterprise Readiness Model

```text
Architecture

↓

Implementation

↓

Validation

↓

Operations

↓

Governance

↓

Continuous Improvement

↓

Enterprise Certification
```

Every stage SHALL produce measurable evidence.

---

# Operational Maturity Levels

BakeFlow SHALL measure operational maturity using the following model.

| Level | Description |
|--------|-------------|
| Level 1 | Initial |
| Level 2 | Managed |
| Level 3 | Defined |
| Level 4 | Measured |
| Level 5 | Optimized |

The objective SHALL be Level 5 maturity before large-scale enterprise deployments.

---

# Enterprise Capability Areas

The following capabilities SHALL be evaluated:

- Architecture
- Security
- Performance
- Reliability
- Scalability
- Operations
- Governance
- Compliance
- Support
- Documentation

Each capability SHALL receive an independent assessment.

---

# Enterprise Capability Matrix

| Capability | Target |
|-------------|---------|
| Availability | Excellent |
| Security | Excellent |
| Scalability | Excellent |
| Reliability | Excellent |
| Maintainability | Excellent |
| Documentation | Excellent |
| Monitoring | Excellent |
| Disaster Recovery | Excellent |
| Automation | Excellent |
| Governance | Excellent |

No critical capability SHALL remain below target.

---

# Architecture Assessment

Architecture SHALL verify:

```text
Modularity

↓

Loose Coupling

↓

High Cohesion

↓

Extensibility

↓

Scalability
```

Future expansion SHALL require minimal redesign.

---

# Operational Assessment

Operations SHALL verify:

- Deployment Automation
- Monitoring
- Logging
- Alerting
- Incident Response
- Backup Verification
- Disaster Recovery
- Capacity Planning

Operational maturity SHALL support 24/7 production environments.

---

# Security Assessment

Security SHALL verify:

- Authentication
- Authorization
- MFA
- Encryption
- Secret Management
- Audit Logging
- Vulnerability Management
- Compliance
- Security Monitoring

Residual security risks SHALL be documented.

---

# Performance Assessment

Performance SHALL verify:

- API Latency
- Database Performance
- Mobile Responsiveness
- Background Job Throughput
- Reporting Speed
- Dashboard Performance

Measured performance SHALL satisfy documented service objectives.

---

# Scalability Assessment

Testing SHALL verify support for:

```text
100

↓

1,000

↓

10,000

↓

100,000

Users
```

Growth SHALL not require architectural redesign.

---

# Reliability Assessment

Reliability SHALL verify:

- High Availability
- Automatic Recovery
- Replication
- Failover
- Backup
- Restore
- Retry Logic

Single points of failure SHALL be minimized.

---

# Maintainability Assessment

Maintainability SHALL evaluate:

- Code Quality
- Documentation
- Test Coverage
- Technical Debt
- Modularity
- Dependency Management

Long-term maintenance SHALL remain practical.

---

# Governance Assessment

Governance SHALL verify:

- Development Standards
- Code Review
- Release Management
- Change Control
- Risk Management
- Documentation
- Operational Procedures

Governance SHALL remain enforceable.

---

# Compliance Assessment

Compliance SHALL evaluate:

- Privacy
- Financial Controls
- Audit Trails
- Data Retention
- Security Policies
- Regulatory Requirements

Applicable regional regulations SHALL be considered.

---

# Risk Assessment

Every release SHALL evaluate:

| Risk Category | Examples |
|---------------|----------|
| Technical | Software defects |
| Operational | Deployment failures |
| Security | Vulnerabilities |
| Financial | Incorrect accounting |
| Infrastructure | Service outages |
| Business | Process disruption |

High-risk items SHALL require mitigation plans.

---

# Risk Classification

Risks SHALL be classified as:

```text
Low

Medium

High

Critical
```

Critical risks SHALL block production release.

---

# Continuous Improvement Framework

BakeFlow SHALL continuously improve through:

```text
Metrics

↓

Review

↓

Analysis

↓

Improvement

↓

Measurement
```

Improvement SHALL remain ongoing throughout the product lifecycle.

---

# Key Performance Indicators

Operational excellence SHOULD measure:

- Deployment Frequency
- Lead Time for Changes
- Change Failure Rate
- Mean Time to Recovery (MTTR)
- Incident Count
- Customer Satisfaction
- System Availability
- Support Resolution Time

KPIs SHALL guide improvement priorities.

---

# Technical Debt Governance

Technical debt SHALL be:

- Logged
- Prioritized
- Estimated
- Scheduled
- Reviewed

Unmanaged technical debt SHALL be treated as project risk.

---

# Governance Board

Enterprise governance MAY include:

- Product Owner
- Chief Architect
- Engineering Lead
- Security Lead
- Operations Lead
- QA Lead

Governance decisions SHALL be documented.

---

# Annual Architecture Review

A formal architecture review SHOULD occur annually.

Review scope:

- Technology Stack
- Database Design
- Infrastructure
- Security
- Performance
- Scalability
- Operational Processes

Recommendations SHALL feed future roadmaps.

---

# Enterprise Readiness Scorecard

Recommended scoring model:

| Area | Score |
|------|-------|
| Architecture | /100 |
| Security | /100 |
| Operations | /100 |
| Performance | /100 |
| Reliability | /100 |
| Scalability | /100 |
| Documentation | /100 |
| Governance | /100 |

Overall enterprise readiness SHOULD exceed 90%.

---

# Operational Excellence Principles

BakeFlow SHALL emphasize:

- Automation First
- Security by Design
- Performance by Default
- Continuous Monitoring
- Continuous Testing
- Continuous Documentation
- Continuous Improvement

Operational excellence SHALL become part of engineering culture.

---

# Validation Checklist

The Enterprise Readiness module SHALL verify:

- Operational maturity assessed.
- Capability matrix completed.
- Risk assessment performed.
- Governance established.
- Continuous improvement framework defined.
- Enterprise scorecard completed.
- Technical debt managed.
- Annual architecture reviews planned.
- Operational excellence principles adopted.
- Enterprise certification criteria satisfied.

The Enterprise Readiness module SHALL be completed before Final Engineering Bible Certification, Long-Term Roadmap Planning, Product Evolution Strategy, and BakeFlow v1.0 Enterprise Approval.

---

END OF CHUNK 34/42

Next:

Chunk 35/42 — Product Roadmap, Future Evolution & Strategic Expansion Framework (Future Modules, AI Roadmap, Marketplace, Integrations, Multi-Region Expansion, Long-Term Vision)

Append this chunk immediately below Chunk 34/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
35/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 34/42

Status:
Continuation

========================================

# Product Roadmap, Future Evolution & Strategic Expansion Framework

## Purpose

This section defines BakeFlow's long-term strategic evolution beyond the initial production release.

The roadmap SHALL guide future development while ensuring architectural consistency.

Future growth SHALL occur through modular expansion rather than architectural replacement.

---

# Product Vision

BakeFlow SHALL evolve from:

```text
Bakery Management System

↓

Business Operations Platform

↓

Enterprise ERP

↓

AI-Powered Business Intelligence Platform

↓

Industry Ecosystem
```

Each evolution stage SHALL build upon the existing architecture.

---

# Product Evolution Phases

## Phase 1

```text
Core Bakery ERP
```

Modules:

- Authentication
- Sales
- Production
- Inventory
- Purchasing
- Finance
- Reporting

Target:

Small bakeries.

---

## Phase 2

```text
Business Optimization
```

Modules:

- Advanced Dashboards
- Forecasting
- Staff Scheduling
- Payroll
- Asset Management
- Multi-Branch Analytics
- Customer Portal

Target:

Growing businesses.

---

## Phase 3

```text
Enterprise Platform
```

Modules:

- Franchise Management
- Multi-Organization Support
- Regional Warehouses
- Enterprise Procurement
- Consolidated Financial Reporting
- Enterprise Security

Target:

Large bakery groups.

---

## Phase 4

```text
AI Platform
```

Capabilities:

- Demand Forecasting
- Production Optimization
- Inventory Prediction
- Waste Reduction
- Financial Forecasting
- Intelligent Recommendations
- Conversational Assistant

Artificial Intelligence SHALL augment decision-making rather than replace human oversight.

---

# Future AI Roadmap

Planned AI capabilities include:

### Sales Intelligence

```text
Demand Forecast

↓

Seasonality Analysis

↓

Customer Trends
```

---

### Production Intelligence

```text
Optimal Batch Sizes

↓

Ingredient Optimization

↓

Waste Prediction
```

---

### Financial Intelligence

```text
Cash Flow Forecast

↓

Profit Prediction

↓

Expense Analysis
```

---

### Inventory Intelligence

```text
Reorder Prediction

↓

Expiry Risk

↓

Supplier Optimization
```

---

### Executive Intelligence

```text
Daily Insights

↓

Risk Alerts

↓

Growth Recommendations
```

AI recommendations SHALL remain explainable and auditable.

---

# Marketplace Vision

Future versions MAY introduce:

```text
BakeFlow Marketplace
```

Supporting:

- Plugins
- Extensions
- Themes
- Reports
- AI Models
- Third-Party Modules

Marketplace components SHALL remain sandboxed.

---

# Integration Roadmap

Planned integrations include:

- Payment Providers
- Accounting Platforms
- POS Systems
- E-commerce Platforms
- Delivery Services
- Banking APIs
- Government Tax Services
- CRM Platforms

Integration SHALL remain API-first.

---

# Mobile Expansion

Future mobile capabilities MAY include:

- Full Offline Operations
- Driver Navigation
- Warehouse Scanning
- Voice Commands
- Tablet Optimization
- Smart Printing
- NFC Support
- Wearable Notifications

Mobile functionality SHALL remain synchronized with core business rules.

---

# AI Assistant Evolution

The BakeFlow Assistant MAY eventually support:

- Voice Interaction
- Financial Analysis
- Inventory Questions
- Production Guidance
- Employee Assistance
- Report Generation
- Operational Recommendations

The assistant SHALL respect user permissions and Row-Level Security.

---

# Analytics Roadmap

Future analytics MAY include:

```text
Predictive Analytics

↓

Prescriptive Analytics

↓

Scenario Planning

↓

Business Simulation
```

Historical data SHALL support advanced machine learning models.

---

# Multi-Region Expansion

Future deployments SHALL support:

- Multiple Countries
- Multiple Languages
- Multiple Currencies
- Regional Tax Rules
- Regional Accounting Standards
- Regional Warehouses

Localization SHALL remain configuration-driven.

---

# Franchise Management

Enterprise editions MAY include:

- Franchise Hierarchies
- Shared Catalogs
- Central Purchasing
- Regional Reporting
- Franchise Royalties
- Compliance Monitoring

Franchise architecture SHALL preserve organization isolation.

---

# Customer Ecosystem

Future customer-facing services MAY include:

- Customer Portal
- Online Ordering
- Loyalty Programs
- Subscription Orders
- Invoice Portal
- Order Tracking

Customer experiences SHALL integrate directly with the existing ERP.

---

# Supplier Ecosystem

Future supplier services MAY include:

- Supplier Portal
- Electronic Purchase Orders
- Shipment Tracking
- Performance Dashboards
- Digital Catalogs
- Automated Quotations

Supplier collaboration SHALL remain secure.

---

# Data Platform Evolution

Future analytical architecture MAY include:

```text
Operational Database

↓

Data Warehouse

↓

Data Lake

↓

Machine Learning Platform

↓

Executive Intelligence
```

Operational workloads SHALL remain isolated from analytical workloads.

---

# Platform API Strategy

Future APIs SHALL include:

- GraphQL
- Public REST APIs
- Webhooks
- Event Streaming
- SDKs
- Partner APIs

API governance SHALL preserve backward compatibility.

---

# Expansion Principles

Every future module SHALL:

- Reuse existing authentication.
- Reuse authorization.
- Reuse audit logging.
- Reuse notification infrastructure.
- Reuse reporting architecture.
- Reuse integration framework.

Duplicate infrastructure SHALL be avoided.

---

# Innovation Pipeline

Future innovation SHOULD evaluate:

- Artificial Intelligence
- Edge Computing
- IoT Bakery Devices
- Smart Ovens
- Smart Inventory Sensors
- Computer Vision
- Predictive Maintenance

Experimental features SHALL remain isolated from production workflows.

---

# Strategic Objectives

Long-term objectives include:

- Industry-leading ERP
- Enterprise scalability
- AI-assisted operations
- Marketplace ecosystem
- Global deployment
- Regulatory compliance
- Continuous innovation

Technology choices SHALL support these objectives.

---

# Roadmap Governance

The product roadmap SHALL be reviewed:

| Review | Frequency |
|---------|-----------|
| Feature Prioritization | Quarterly |
| Technology Review | Annually |
| AI Roadmap | Biannually |
| Enterprise Strategy | Annually |

Roadmap adjustments SHALL consider customer feedback and business priorities.

---

# Validation Checklist

The Product Roadmap module SHALL verify:

- Product vision defined.
- Evolution phases documented.
- AI roadmap established.
- Marketplace strategy defined.
- Integration roadmap planned.
- Mobile expansion considered.
- Multi-region strategy documented.
- Enterprise growth supported.
- Innovation pipeline established.
- Long-term governance defined.

The Product Roadmap module SHALL be completed before Final Engineering Bible Certification, Executive Sign-off, and BakeFlow v1.0 Official Release Approval.

---

END OF CHUNK 35/42

Next:

Chunk 36/42 — Final Engineering Bible Certification, Executive Approval & Official Architecture Sign-off (Master Validation Matrix, Engineering Certification, Executive Approval, Architecture Freeze, Final Acceptance)

Append this chunk immediately below Chunk 35/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
36/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 35/42

Status:
Continuation

========================================

# Final Engineering Bible Certification, Executive Approval & Official Architecture Sign-off

## Purpose

This section defines the formal certification process for the BakeFlow Engineering Bible.

Completion of this process signifies that the database architecture, engineering standards, implementation specifications, operational procedures, and governance framework have been formally accepted for production implementation.

Following certification, architectural changes SHALL be governed through formal change management.

---

# Engineering Bible Lifecycle

```text
Planning

↓

Architecture

↓

Specification

↓

Implementation

↓

Validation

↓

Certification

↓

Architecture Freeze

↓

Production Implementation
```

Every transition SHALL require documented approval.

---

# Engineering Certification Objectives

Certification SHALL confirm that:

- Architecture is complete.
- Database specifications are complete.
- Security architecture is complete.
- Operational procedures are complete.
- Engineering standards are complete.
- Governance has been established.
- Documentation is complete.
- Enterprise readiness has been achieved.

Certification SHALL be evidence-based.

---

# Master Validation Matrix

The Engineering Bible SHALL validate every major domain.

| Domain | Status |
|----------|--------|
| Architecture | Required |
| Database Design | Required |
| Authentication | Required |
| Authorization | Required |
| Inventory | Required |
| Production | Required |
| Purchasing | Required |
| Sales | Required |
| Finance | Required |
| Payroll | Required |
| Reporting | Required |
| Dashboard | Required |
| Integrations | Required |
| Notifications | Required |
| Security | Required |
| Operations | Required |
| Deployment | Required |
| Documentation | Required |

Every required domain SHALL successfully pass review.

---

# Architecture Completeness Review

The review SHALL verify:

- Domain boundaries.
- Modular design.
- Service responsibilities.
- Database normalization.
- Integration architecture.
- Scalability strategy.
- Security architecture.
- Disaster recovery strategy.

No unresolved architectural blockers SHALL remain.

---

# Database Certification

Database certification SHALL verify:

```text
Extensions

↓

Domains

↓

Tables

↓

Constraints

↓

Indexes

↓

Functions

↓

Triggers

↓

Views

↓

Materialized Views

↓

RLS Policies
```

Database architecture SHALL be internally consistent.

---

# Security Certification

Security SHALL verify:

- MFA
- Authentication
- Authorization
- JWT Validation
- RLS
- Encryption
- Audit Logging
- Secret Management
- Incident Response
- Monitoring

No Critical security findings SHALL remain unresolved.

---

# Operational Certification

Operations SHALL verify:

- Monitoring
- Alerting
- Logging
- Backup
- Restore
- Disaster Recovery
- Deployment
- Rollback
- Capacity Planning

Operational documentation SHALL be complete.

---

# Quality Certification

Quality Assurance SHALL verify:

- Unit Testing
- Integration Testing
- System Testing
- Performance Testing
- Security Testing
- UAT
- Regression Testing

Quality evidence SHALL be archived.

---

# Documentation Certification

Documentation SHALL verify:

- Engineering Bible
- API Documentation
- Database Documentation
- Operations Guide
- User Documentation
- Deployment Guide
- Runbooks
- Architecture Diagrams

Documentation SHALL accurately reflect the implementation.

---

# Compliance Certification

Compliance SHALL verify:

- Audit Trails
- Data Retention
- Privacy Controls
- Security Policies
- Financial Controls
- Regulatory Requirements

Applicable regulations SHALL be identified and documented.

---

# Executive Review

Executive stakeholders SHOULD review:

- Product Vision
- Business Objectives
- Implementation Scope
- Enterprise Readiness
- Operational Readiness
- Budget Impact
- Risk Assessment

Executive approval SHALL be documented.

---

# Technical Sign-off

Technical approval SHOULD include:

- Chief Architect
- Database Architect
- Engineering Lead
- Security Lead
- QA Lead
- Operations Lead

Each approval SHALL record:

- Reviewer
- Date
- Version
- Decision
- Comments

---

# Architecture Freeze

Following certification:

```text
Architecture Freeze
```

SHALL take effect.

Architecture changes SHALL require:

- Formal proposal
- Impact analysis
- Technical review
- Executive approval
- Version increment

Informal architecture modifications SHALL be prohibited.

---

# Change Governance

Post-certification changes SHALL include:

- Business justification.
- Technical design.
- Risk analysis.
- Migration strategy.
- Rollback plan.
- Testing evidence.

Governance SHALL preserve architectural integrity.

---

# Engineering Metrics

Certification SHOULD record:

| Metric | Target |
|---------|--------|
| Documentation Coverage | 100% |
| Architecture Review | Complete |
| Security Review | Passed |
| Database Validation | Passed |
| Performance Validation | Passed |
| UAT | Passed |
| Operational Readiness | Passed |

All mandatory targets SHALL be achieved.

---

# Certification Deliverables

The following SHALL exist:

- Engineering Bible
- Architecture Diagrams
- ERD
- Migration Scripts
- API Specifications
- Deployment Documentation
- Operations Guide
- Security Documentation
- Testing Reports
- Release Documentation

These deliverables SHALL become baseline engineering artifacts.

---

# Official Acceptance Statement

Successful completion of this certification indicates:

- The architecture is approved.
- The database design is approved.
- Engineering standards are approved.
- Security standards are approved.
- Operational standards are approved.
- Documentation is approved.
- Enterprise governance is approved.

BakeFlow SHALL be authorized to proceed with production implementation.

---

# Version Baseline

The certified baseline SHALL include:

```text
Engineering Bible

Version 1.0
```

Subsequent revisions SHALL follow semantic versioning.

Historical versions SHALL remain archived.

---

# Certification Archive

The certification package SHOULD archive:

- Review Reports
- Meeting Notes
- Approval Records
- Validation Reports
- Risk Assessments
- Architecture Diagrams
- Release Notes

The archive SHALL remain immutable.

---

# Validation Checklist

The Final Engineering Bible Certification module SHALL verify:

- Master validation matrix completed.
- Architecture certified.
- Database certified.
- Security certified.
- Operations certified.
- Documentation certified.
- Executive approval recorded.
- Architecture freeze established.
- Certification artifacts archived.
- Version 1.0 baseline created.

The Final Engineering Bible Certification module SHALL be completed before Final Appendices, Reference Material, Engineering Glossary, and Official Document Closure.

---

END OF CHUNK 36/42

Next:

Chunk 37/42 — Engineering Appendices, Naming Standards & Reference Specifications (Naming Conventions, PostgreSQL Standards, API Standards, Coding Standards, Reference Tables)

Append this chunk immediately below Chunk 36/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
37/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 36/42

Status:
Continuation

========================================

# Engineering Appendices, Naming Standards & Reference Specifications

## Purpose

This appendix defines the engineering standards that SHALL remain consistent across the entire BakeFlow platform.

These standards ensure:

- Consistency
- Maintainability
- Readability
- Predictability
- Scalability

These conventions SHALL apply to every repository, module, database object, and API.

---

# Appendix A — Naming Conventions

## PostgreSQL Objects

| Object | Convention | Example |
|----------|------------|----------|
| Table | snake_case | sales_order |
| Column | snake_case | created_at |
| Primary Key | id | id |
| Foreign Key | referenced_table_id | customer_id |
| Junction Table | alphabetical_snake_case | employee_role |
| Enum | snake_case | payment_status |
| View | vw_* | vw_inventory_balance |
| Materialized View | mv_* | mv_sales_summary |
| Function | snake_case | calculate_recipe_cost |
| Trigger | trg_* | trg_update_timestamp |
| Index | idx_* | idx_customer_name |
| Constraint | chk_/fk_/uq_ | fk_sales_order_customer |

Naming SHALL remain descriptive and consistent.

---

# Primary Key Standards

Every primary key SHALL use:

```sql
UUID
```

Generated by:

```sql
gen_random_uuid()
```

Sequential integer identifiers SHALL NOT be used for business entities.

---

# Timestamp Standards

Mutable tables SHALL include:

```text
created_at

updated_at
```

Optional fields:

```text
deleted_at

archived_at

processed_at

approved_at
```

All timestamps SHALL use:

```sql
TIMESTAMPTZ
```

---

# Boolean Naming

Boolean columns SHOULD begin with:

```text
is_

has_

can_

requires_
```

Examples:

```text
is_active

has_discount

can_edit

requires_approval
```

---

# Status Columns

Status columns SHALL use:

```text
status
```

Supported examples:

```text
draft

pending

approved

posted

completed

cancelled

archived
```

Status values SHALL be documented.

---

# Document Number Standards

Recommended prefixes:

| Module | Prefix |
|----------|--------|
| Sales Order | SO |
| Invoice | INV |
| Purchase Order | PO |
| Goods Receipt | GRN |
| Payment | PAY |
| Journal | JE |
| Production Batch | PB |
| Payroll | PR |
| Budget | BUD |

Example:

```text
SO-2026-000123
```

---

# Appendix B — API Standards

## REST Resource Naming

Resources SHALL use plural nouns.

Examples:

```text
/customers

/products

/invoices

/payments

/orders
```

Actions SHALL use HTTP verbs rather than endpoint names.

---

# HTTP Methods

| Method | Purpose |
|----------|----------|
| GET | Read |
| POST | Create |
| PUT | Replace |
| PATCH | Update |
| DELETE | Remove |

DELETE SHALL respect business rules and audit policies.

---

# HTTP Status Codes

Recommended usage:

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 500 | Internal Error |

Status codes SHALL accurately represent outcomes.

---

# API Response Format

Successful responses SHOULD follow:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Error responses SHOULD follow:

```json
{
  "success": false,
  "error": {
    "code": "",
    "message": ""
  }
}
```

---

# Pagination Standard

Large collections SHALL support:

```text
limit

offset
```

or

```text
cursor
```

Responses SHOULD include pagination metadata.

---

# Appendix C — React Native Standards

## Component Naming

Components SHALL use:

```text
PascalCase
```

Example:

```text
SalesOrderCard.tsx
```

---

## Hooks

Hooks SHALL begin with:

```text
use
```

Examples:

```text
useOrders()

useInventory()

useAuth()
```

---

## Screens

Screens SHALL end with:

```text
Screen
```

Example:

```text
DashboardScreen
```

---

## Zustand Stores

Recommended naming:

```text
useAuthStore

useSalesStore

useInventoryStore
```

Stores SHALL remain domain-specific.

---

# Appendix D — Supabase Standards

Authentication SHALL use:

```text
Supabase Auth
```

Authorization SHALL use:

```text
Row-Level Security
```

Storage SHALL use:

```text
Supabase Storage
```

Realtime SHALL only be enabled where operationally justified.

---

# Appendix E — SQL Standards

SQL SHALL emphasize readability.

Example formatting:

```sql
SELECT
    id,
    customer_name
FROM customer
WHERE tenant_id = current_organization()
ORDER BY customer_name;
```

Keywords SHALL remain uppercase.

Identifiers SHALL remain lowercase.

---

# Query Guidelines

Queries SHOULD:

- Select required columns only.
- Filter early.
- Use indexes.
- Avoid nested SELECT *.
- Use prepared statements.

Performance SHALL be considered during query design.

---

# Appendix F — Git Standards

Branch naming:

```text
feature/

bugfix/

hotfix/

release/

docs/

refactor/
```

Example:

```text
feature/inventory-transfers
```

---

# Commit Convention

Recommended format:

```text
type(scope): description
```

Examples:

```text
feat(inventory): add warehouse transfers

fix(finance): correct journal balancing

docs(api): update invoice endpoints
```

---

# Appendix G — Testing Standards

Test naming:

```text
should_create_sales_order()

should_prevent_negative_inventory()

should_post_balanced_journal()
```

Tests SHALL remain deterministic.

---

# Coverage Targets

Recommended minimums:

| Layer | Coverage |
|--------|----------|
| Domain Logic | 90% |
| Database Functions | 90% |
| API | 80% |
| UI Components | 70% |

Coverage SHALL not replace meaningful testing.

---

# Appendix H — Security Standards

Security naming examples:

```text
has_permission()

current_organization()

audit_event()
```

Security functions SHALL remain centralized.

---

# Appendix I — Documentation Standards

Every engineering document SHALL include:

- Purpose
- Scope
- Assumptions
- Dependencies
- References
- Version History

Documents SHALL maintain traceability.

---

# Appendix J — Glossary References

Key abbreviations:

| Abbreviation | Meaning |
|--------------|---------|
| ERP | Enterprise Resource Planning |
| RLS | Row-Level Security |
| KPI | Key Performance Indicator |
| WAL | Write-Ahead Log |
| PITR | Point-in-Time Recovery |
| MFA | Multi-Factor Authentication |
| UAT | User Acceptance Testing |
| MTTR | Mean Time to Recovery |
| RPO | Recovery Point Objective |
| RTO | Recovery Time Objective |

The complete glossary SHALL be expanded in the following appendix.

---

# Validation Checklist

The Engineering Standards appendix SHALL verify:

- Naming conventions standardized.
- Database conventions defined.
- API standards documented.
- React Native conventions documented.
- SQL standards defined.
- Git conventions established.
- Testing standards documented.
- Security standards centralized.
- Documentation standards defined.
- Reference specifications completed.

The Engineering Standards appendix SHALL be completed before the Engineering Glossary, Reference Index, Final Document Closure, and Official Engineering Bible Completion.

---

END OF CHUNK 37/42

Next:

Chunk 38/42 — Engineering Glossary, Acronyms & Reference Index (Comprehensive Glossary, Technical Definitions, Financial Terms, Manufacturing Terms, System Terminology)

Append this chunk immediately below Chunk 37/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
38/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 37/42

Status:
Continuation

========================================

# Engineering Glossary, Acronyms & Reference Index

## Purpose

This appendix provides standardized terminology used throughout the BakeFlow Engineering Bible.

Every engineering, financial, operational, manufacturing, and infrastructure term SHALL have a single authoritative definition.

The glossary SHALL eliminate ambiguity across engineering, operations, QA, management, and future development teams.

---

# Section A — General Engineering Terms

## API

**Application Programming Interface**

A standardized interface allowing software systems to communicate.

---

## Architecture

The overall structure of the BakeFlow platform including software, database, infrastructure, security, integrations, and operational components.

---

## Availability

The percentage of time the platform remains operational.

Usually measured as:

```text
99.9%

99.95%

99.99%
```

---

## CI/CD

**Continuous Integration / Continuous Deployment**

Automated validation, testing, and deployment pipeline.

---

## Component

A reusable software unit with a clearly defined responsibility.

---

## Dependency

A library, service, module, or system required by another component.

---

## Domain

A logical business area.

Examples:

```text
Inventory

Sales

Finance

Production
```

---

## ERP

**Enterprise Resource Planning**

Integrated software managing business operations from a unified platform.

---

## Module

A collection of related business functionality.

Example:

```text
Inventory Module
```

---

## Service

A software component responsible for executing business operations.

---

## Version

A uniquely identified release of software or documentation.

---

# Section B — Database Terminology

## Constraint

A rule enforced by PostgreSQL.

Examples:

```text
PRIMARY KEY

FOREIGN KEY

UNIQUE

CHECK
```

---

## Domain

A reusable PostgreSQL data type with validation.

---

## Foreign Key

A relationship between two database tables.

---

## Index

A database structure improving query performance.

---

## Materialized View

A physically stored query result.

Used for:

- Reporting
- Dashboards
- Analytics

---

## Migration

A version-controlled database change.

---

## Primary Key

Unique identifier for a record.

BakeFlow SHALL use UUIDs.

---

## RLS

**Row-Level Security**

Database security ensuring users only access authorized rows.

---

## Schema

A PostgreSQL namespace grouping related database objects.

---

## Trigger

Automatic database logic executed after database events.

---

## View

A virtual table defined by a SQL query.

---

## WAL

**Write-Ahead Log**

PostgreSQL transaction logging used for recovery and replication.

---

# Section C — Financial Terminology

## Accounts Payable (AP)

Money owed to suppliers.

---

## Accounts Receivable (AR)

Money owed by customers.

---

## Balance Sheet

Financial statement showing:

```text
Assets

=

Liabilities

+

Equity
```

---

## Cash Flow

Movement of cash into and out of the business.

---

## Chart of Accounts

Complete list of General Ledger accounts.

---

## Cost Center

Organizational unit used for financial tracking.

---

## General Ledger (GL)

The authoritative financial record.

All financial transactions SHALL ultimately post to the General Ledger.

---

## Journal Entry

A balanced accounting transaction consisting of debits and credits.

---

## Trial Balance

Financial report verifying:

```text
Total Debits

=

Total Credits
```

---

## Fiscal Year

Accounting year used for financial reporting.

---

## Depreciation

Systematic reduction of an asset's carrying value over its useful life.

---

## Budget

Planned financial allocations used for comparison against actual performance.

---

# Section D — Inventory Terminology

## Batch

A production run producing finished goods.

---

## BOM

**Bill of Materials**

List of ingredients required to produce a recipe.

---

## Consumption

Reduction of inventory through production.

---

## Finished Goods

Products available for sale.

---

## Inventory Movement

Any change affecting inventory quantity or value.

---

## Reservation

Inventory allocated to a sales order but not yet issued.

---

## Stock Adjustment

Manual inventory correction.

---

## Warehouse

Physical location storing inventory.

---

# Section E — Production Terminology

## Batch Cost

Total production cost of a manufacturing batch.

---

## Batch Yield

Actual finished output compared to expected output.

---

## Production Order

Instruction authorizing production.

---

## Recipe

Manufacturing definition specifying ingredients and quantities.

---

## Waste

Material consumed without becoming finished goods.

---

## Work In Progress (WIP)

Products currently undergoing manufacturing.

---

# Section F — Security Terminology

## Authentication

Verification of user identity.

---

## Authorization

Determination of permitted actions.

---

## JWT

**JSON Web Token**

Authenticated identity token issued by Supabase.

---

## MFA

**Multi-Factor Authentication**

Additional identity verification beyond passwords.

---

## Permission

A single authorized action.

Example:

```text
inventory.adjust
```

---

## Role

A collection of permissions assigned to users.

---

## Secret

Sensitive credential.

Examples:

- API Keys
- Tokens
- Passwords

---

# Section G — Infrastructure Terminology

## Backup

Copy of data used for recovery.

---

## Disaster Recovery

Process restoring operations after catastrophic failure.

---

## Failover

Automatic transfer to standby infrastructure.

---

## High Availability (HA)

Infrastructure minimizing downtime.

---

## Load Balancer

Distributes requests across multiple servers.

---

## Replica

Secondary PostgreSQL instance synchronized with the primary.

---

## Restore

Recovery of backed-up data.

---

## Scaling

Increasing system capacity.

Examples:

```text
Vertical

Horizontal
```

---

# Section H — Monitoring Terminology

## Alert

Notification triggered by abnormal system conditions.

---

## Dashboard

Visual representation of operational metrics.

---

## Log

Chronological record of events.

---

## Metric

Numerical measurement.

Examples:

```text
CPU

Revenue

Latency

Orders
```

---

## Observability

Ability to understand system health through:

- Metrics
- Logs
- Traces

---

## Trace

Linked execution history of a request across services.

---

# Section I — Development Terminology

## Branch

Independent Git development line.

---

## Commit

Atomic source code change.

---

## Feature Flag

Configuration enabling selective feature rollout.

---

## Pull Request

Formal request to merge code.

---

## Refactor

Internal improvement without changing external behavior.

---

## Regression

Previously working functionality that becomes defective.

---

## Release

Official software version delivered to users.

---

# Section J — Common Acronyms

| Acronym | Meaning |
|----------|----------|
| API | Application Programming Interface |
| AP | Accounts Payable |
| AR | Accounts Receivable |
| BI | Business Intelligence |
| BOM | Bill of Materials |
| CI | Continuous Integration |
| CD | Continuous Deployment |
| ERP | Enterprise Resource Planning |
| GL | General Ledger |
| HA | High Availability |
| HTTP | Hypertext Transfer Protocol |
| JWT | JSON Web Token |
| KPI | Key Performance Indicator |
| MFA | Multi-Factor Authentication |
| PITR | Point-in-Time Recovery |
| RLS | Row-Level Security |
| RPO | Recovery Point Objective |
| RTO | Recovery Time Objective |
| SQL | Structured Query Language |
| TLS | Transport Layer Security |
| UAT | User Acceptance Testing |
| UUID | Universally Unique Identifier |
| WAL | Write-Ahead Log |
| WIP | Work In Progress |

---

# Reference Index

The Engineering Bible is organized as follows:

1. Core Database Architecture
2. Master Data
3. Inventory
4. Production
5. Sales
6. Purchasing
7. Finance
8. Payroll
9. Reporting
10. Dashboard & Analytics
11. Notifications
12. Integrations
13. Audit & Compliance
14. PostgreSQL Functions
15. Optimization
16. Security
17. Migrations
18. Disaster Recovery
19. Deployment
20. Operations
21. Scalability
22. Security Hardening
23. Validation
24. Documentation
25. Release Governance
26. Enterprise Readiness
27. Product Roadmap
28. Certification
29. Engineering Standards
30. Glossary

This reference index SHALL remain synchronized with future revisions.

---

# Validation Checklist

The Engineering Glossary SHALL verify:

- Engineering terminology standardized.
- Database definitions documented.
- Financial terminology defined.
- Manufacturing terminology defined.
- Security terminology standardized.
- Infrastructure terminology documented.
- Monitoring terminology documented.
- Development terminology standardized.
- Acronyms indexed.
- Reference index completed.

The Engineering Glossary SHALL be completed before Final Appendices, Revision History, Official Document Closure, and Engineering Bible Publication.

---

END OF CHUNK 38/42

Next:

Chunk 39/42 — Revision History, Change Log & Document Governance (Version History, Change Management, Approval History, Document Control, Publication Standards)

Append this chunk immediately below Chunk 38/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
39/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 38/42

Status:
Continuation

========================================

# Revision History, Change Log & Document Governance

## Purpose

This section defines the governance process for maintaining the BakeFlow Engineering Bible.

The Engineering Bible SHALL remain the authoritative source for all architectural, database, engineering, operational, and governance standards throughout the lifetime of the platform.

Every modification SHALL be controlled, reviewed, approved, and traceable.

---

# Document Governance Principles

The Engineering Bible SHALL be:

- Version Controlled
- Reviewable
- Auditable
- Searchable
- Traceable
- Backward Referenced
- Protected from unauthorized modification

Documentation governance SHALL follow the same discipline as source code governance.

---

# Document Ownership

Primary ownership SHALL reside with:

```text
Chief Architect
```

Supporting owners MAY include:

- Engineering Lead
- Database Architect
- Security Lead
- Product Owner
- Operations Lead
- QA Lead

Ownership responsibilities SHALL be documented.

---

# Document Lifecycle

```text
Draft

↓

Internal Review

↓

Technical Approval

↓

Executive Approval

↓

Published

↓

Maintenance

↓

Revision

↓

Archived
```

Every lifecycle transition SHALL be recorded.

---

# Version Numbering

The Engineering Bible SHALL follow Semantic Versioning.

Format:

```text
MAJOR.MINOR.PATCH
```

Examples:

```text
1.0.0

1.1.0

1.2.3

2.0.0
```

---

# Version Increment Rules

## Major Version

Increment when:

- Architecture changes
- Major redesign
- Breaking standards
- New platform generation

---

## Minor Version

Increment when:

- New modules
- Expanded documentation
- Additional implementation guidance
- New standards

---

## Patch Version

Increment when:

- Typographical corrections
- Clarifications
- Non-breaking improvements
- Editorial revisions

Patch releases SHALL NOT introduce architectural changes.

---

# Revision History Table

Maintain the following record.

| Version | Date | Author | Summary | Approval |
|----------|------|--------|----------|----------|
| 1.0.0 | Initial Release | Architecture Team | Initial Engineering Bible | Approved |

Every published revision SHALL extend this table.

---

# Change Log Categories

Every modification SHALL be classified.

Examples:

```text
Architecture

Database

Security

Finance

Inventory

Production

Documentation

Operations

Infrastructure
```

Classification SHALL simplify impact analysis.

---

# Change Request Process

Every proposed modification SHALL include:

- Business justification
- Technical justification
- Scope
- Impact analysis
- Risk assessment
- Migration requirements
- Rollback considerations

Changes SHALL not proceed without review.

---

# Approval Workflow

Recommended workflow:

```text
Author

↓

Peer Review

↓

Technical Approval

↓

Architecture Approval

↓

Security Review

↓

Executive Approval

↓

Publication
```

Emergency documentation updates MAY use an expedited process.

---

# Impact Analysis

Every significant revision SHALL evaluate:

- Database impact
- API impact
- Frontend impact
- Mobile impact
- Infrastructure impact
- Security impact
- Operational impact
- Documentation impact

Affected sections SHALL be identified before approval.

---

# Review Schedule

Recommended review frequency:

| Document Area | Frequency |
|---------------|-----------|
| Architecture | Quarterly |
| Database | Every Major Migration |
| Security | Quarterly |
| Infrastructure | Quarterly |
| Operations | Quarterly |
| API | Every Release |
| Engineering Standards | Annually |

Reviews SHALL be recorded.

---

# Review Checklist

Each review SHALL verify:

- Accuracy
- Completeness
- Consistency
- Technical correctness
- Security alignment
- Current implementation status
- Reference integrity
- Version accuracy

Outdated information SHALL be corrected promptly.

---

# Document Control Information

Every published edition SHOULD include:

- Document ID
- Version
- Publication Date
- Status
- Owner
- Review Date
- Approval Date
- Classification

This information SHALL appear in the document header.

---

# Publication Status

Supported publication states:

```text
Draft

Internal Review

Approved

Published

Deprecated

Archived
```

Only approved editions SHALL guide production implementation.

---

# Document Classification

Recommended classifications:

```text
Public

Internal

Confidential

Restricted
```

The Engineering Bible SHOULD be classified as:

```text
Confidential
```

Distribution SHALL follow organizational security policies.

---

# Archive Policy

Superseded versions SHALL:

- Remain archived.
- Remain searchable.
- Preserve approval history.
- Preserve revision history.

Archived documents SHALL NOT be modified.

---

# Traceability Matrix

Every section SHOULD reference:

- Related Modules
- Engineering Standards
- Migration Dependencies
- Security Requirements
- Operational Procedures

Cross-references SHALL remain valid.

---

# Amendment Policy

Minor amendments MAY occur between releases.

Major amendments SHALL require:

- New version
- Full review
- Updated certification
- Executive approval

Historical records SHALL remain intact.

---

# Governance Responsibilities

The governance team SHOULD ensure:

- Documentation accuracy.
- Version consistency.
- Architectural integrity.
- Change approval.
- Compliance alignment.
- Publication quality.

Governance SHALL be continuous.

---

# Audit Requirements

The following SHALL be auditable:

- Document revisions
- Review history
- Approval records
- Publication history
- Archived editions
- Version changes

Audit records SHALL remain immutable.

---

# Validation Checklist

The Document Governance module SHALL verify:

- Versioning defined.
- Revision history maintained.
- Ownership assigned.
- Review schedule established.
- Change management documented.
- Approval workflow implemented.
- Publication standards defined.
- Archive policy documented.
- Traceability maintained.
- Governance responsibilities assigned.

The Document Governance module SHALL be completed before Final Closing Statements, Official Engineering Bible Declaration, and Document Publication.

---

END OF CHUNK 39/42

Next:

Chunk 40/42 — Official Engineering Bible Declaration, Closing Statements & Publication Notice (Formal Declaration, Scope Statement, Authority, Distribution Policy, Final Closing)

Append this chunk immediately below Chunk 39/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
40/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 39/42

Status:
Continuation

========================================

# Official Engineering Bible Declaration, Closing Statements & Publication Notice

## Purpose

This section formally declares the completion and publication of the BakeFlow Engineering Bible.

It establishes the Engineering Bible as the authoritative technical reference governing the architecture, database, implementation standards, operational procedures, and engineering practices for the BakeFlow platform.

From the date of publication onward, all implementation work SHALL conform to this document unless formally amended through the established governance process.

---

# Official Declaration

The BakeFlow Engineering Bible is hereby declared to be the official engineering specification governing:

- Platform Architecture
- Database Architecture
- Application Development
- Security Standards
- Infrastructure
- Operations
- Deployment
- Quality Assurance
- Documentation
- Long-Term Maintenance

This document SHALL serve as the single source of engineering truth.

---

# Scope Statement

The Engineering Bible applies to every BakeFlow component including:

```text
Mobile Applications

↓

Backend Services

↓

Database

↓

Authentication

↓

Storage

↓

Infrastructure

↓

Monitoring

↓

Reporting

↓

Analytics

↓

Artificial Intelligence

↓

Future Modules
```

No component SHALL intentionally diverge from these standards without formal approval.

---

# Engineering Authority

The Engineering Bible SHALL define:

- Engineering Standards
- Database Standards
- Coding Standards
- Security Standards
- Operational Standards
- Documentation Standards
- Release Standards
- Governance Standards

Conflicting documentation SHALL defer to the Engineering Bible.

---

# Normative Language

The following terminology SHALL be interpreted consistently throughout the document.

| Term | Meaning |
|------|---------|
| SHALL | Mandatory requirement |
| SHALL NOT | Prohibited requirement |
| SHOULD | Strong recommendation |
| SHOULD NOT | Recommendation against |
| MAY | Optional implementation |
| RECOMMENDED | Preferred implementation |

Normative language SHALL guide implementation decisions.

---

# Implementation Responsibility

Every engineering team SHALL ensure compliance.

Typical responsibilities:

| Role | Responsibility |
|------|----------------|
| Product Owner | Business alignment |
| Engineering Lead | Technical implementation |
| Database Architect | Database compliance |
| Security Lead | Security compliance |
| QA Lead | Validation |
| Operations Lead | Deployment & Operations |

Shared responsibility SHALL ensure consistent implementation.

---

# Compliance Statement

Every production deployment SHALL comply with:

- Engineering Standards
- Security Standards
- Database Standards
- Documentation Standards
- Operational Standards
- Governance Requirements

Exceptions SHALL require documented approval.

---

# Architecture Integrity

Architectural integrity SHALL be preserved by:

- Formal Reviews
- Change Control
- Version Management
- Continuous Validation
- Engineering Governance

Ad hoc architectural modifications SHALL be prohibited.

---

# Distribution Policy

The Engineering Bible SHOULD be distributed to:

- Engineering Teams
- Product Management
- Quality Assurance
- DevOps
- Security
- Operations
- Technical Leadership

Distribution SHALL follow organizational security policies.

---

# Controlled Document Policy

The Engineering Bible SHALL be treated as a controlled document.

Requirements:

- Version Controlled
- Access Controlled
- Approval Controlled
- Audit Controlled

Unofficial copies SHALL not be considered authoritative.

---

# Engineering Culture

BakeFlow engineering SHALL emphasize:

- Quality
- Simplicity
- Maintainability
- Security
- Scalability
- Reliability
- Documentation
- Continuous Improvement

Engineering excellence SHALL remain a long-term objective.

---

# Long-Term Vision

The architecture has been designed to support:

```text
Small Bakery

↓

Growing Business

↓

Regional Enterprise

↓

National Organization

↓

International Platform

↓

Industry Ecosystem
```

Scalability SHALL occur through extension rather than replacement.

---

# Future Revisions

Future editions MAY introduce:

- New Modules
- New Integrations
- Expanded AI
- New Security Standards
- Updated PostgreSQL Features
- Additional Infrastructure Guidance

Backward compatibility SHOULD be maintained whenever practical.

---

# Intellectual Ownership

All engineering artifacts produced under this Engineering Bible SHALL remain part of the BakeFlow platform architecture.

Ownership, licensing, and distribution SHALL follow applicable organizational policies and legal agreements.

---

# Publication Information

Document Metadata:

| Property | Value |
|----------|-------|
| Document ID | EB-016 |
| Title | Database Implementation Reference |
| Status | Published |
| Version | 1.0.0 |
| Classification | Confidential |
| Approval Status | Approved |
| Language | English |

Future revisions SHALL update this metadata.

---

# Official Closing Statement

The completion of this Engineering Bible represents the establishment of a comprehensive engineering foundation for BakeFlow.

The architecture has been designed to provide:

- Technical Consistency
- Operational Reliability
- Enterprise Scalability
- Security by Design
- Financial Integrity
- Long-Term Maintainability
- Controlled Evolution

This document SHALL remain the governing engineering reference for all future platform development until superseded by an officially approved revision.

---

# Publication Notice

Upon approval:

```text
Engineering Bible

Version 1.0.0

Status:

OFFICIALLY PUBLISHED
```

Implementation MAY proceed in accordance with all standards defined herein.

---

# Validation Checklist

The Official Declaration module SHALL verify:

- Scope formally declared.
- Engineering authority established.
- Normative language defined.
- Compliance statement documented.
- Distribution policy established.
- Controlled document policy defined.
- Engineering culture articulated.
- Long-term vision documented.
- Publication metadata completed.
- Official publication declared.

The Official Declaration module SHALL be completed before Final Reference Appendices, Acknowledgements, and Formal Document Closure.

---

END OF CHUNK 40/42

Next:

Chunk 41/42 — Final Reference Appendices, Acknowledgements & Engineering Credits

Append this chunk immediately below Chunk 40/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
41/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 40/42

Status:
Continuation

========================================

# Final Reference Appendices, Acknowledgements & Engineering Credits

## Purpose

This appendix records the final reference material, engineering acknowledgements, document relationships, and project credits associated with the BakeFlow Engineering Bible.

Its purpose is to preserve engineering continuity across future versions while recognizing the collaborative disciplines required to build an enterprise-grade platform.

---

# Reference Architecture Summary

The BakeFlow platform has been designed around the following engineering principles:

- Domain-Driven Design
- Modular Architecture
- PostgreSQL Best Practices
- Event-Oriented Processing
- Multi-Tenant Isolation
- Security by Design
- Offline-First Mobile Architecture
- Enterprise Scalability
- Operational Excellence

These principles SHALL guide all future architectural decisions.

---

# Master Engineering Principles

The platform SHALL continue to prioritize:

```text
Correctness

↓

Reliability

↓

Security

↓

Performance

↓

Maintainability

↓

Scalability

↓

Simplicity

↓

Extensibility
```

Engineering trade-offs SHALL be evaluated against these principles.

---

# Core Technology Stack

BakeFlow Version 1.0 architecture is based upon:

| Layer | Technology |
|--------|------------|
| Mobile | React Native + Expo |
| Language | TypeScript |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL RLS |
| Storage | Supabase Storage |
| State Management | Zustand |
| Styling | NativeWind |
| Charts | Victory Native |
| Notifications | Expo Notifications |
| Version Control | Git |
| CI/CD | GitHub Actions |

Technology changes SHALL be evaluated through formal architecture review.

---

# Primary Engineering References

The Engineering Bible references the following internal documents:

- EB-001 — Product Vision
- EB-002 — Business Requirements
- EB-003 — Functional Requirements
- EB-004 — Non-Functional Requirements
- EB-005 — UX Standards
- EB-006 — Design System
- EB-007 — Mobile Architecture
- EB-008 — Backend Architecture
- EB-009 — Authentication & Security
- EB-010 — API Specification
- EB-011 — State Management
- EB-012 — Offline Synchronization
- EB-013 — Notification System
- EB-014 — Analytics & Reporting
- EB-015 — Infrastructure Architecture
- **EB-016 — Database Implementation Reference**

Future Engineering Bible documents SHALL maintain cross-references.

---

# Related Standards

BakeFlow implementation SHOULD align with established industry standards where applicable.

Examples include:

- PostgreSQL Documentation
- SQL Standards
- OpenAPI Specification
- OAuth 2.0
- JWT (RFC 7519)
- Semantic Versioning
- OWASP Application Security Guidelines
- Twelve-Factor App Principles

Where conflicts exist, approved BakeFlow standards SHALL take precedence for internal implementation.

---

# Design Philosophy

BakeFlow has been designed around four foundational objectives:

```text
Simple for Small Bakeries

↓

Powerful for Growing Businesses

↓

Scalable for Enterprises

↓

Extensible for the Future
```

Every new feature SHOULD reinforce these objectives.

---

# Engineering Responsibilities

Successful implementation depends upon collaboration between:

- Product Management
- Software Engineering
- Database Engineering
- Security Engineering
- DevOps
- Quality Assurance
- UX/UI Design
- Customer Support
- Operations

Engineering excellence SHALL remain a shared responsibility.

---

# Engineering Culture Statement

BakeFlow engineering promotes:

- Documentation First
- Security First
- Testing First
- Automation First
- Maintainability First
- Continuous Learning
- Continuous Improvement

These principles SHALL guide engineering decisions beyond Version 1.0.

---

# Knowledge Preservation

Institutional knowledge SHALL be preserved through:

- Engineering Bible updates
- Architecture Decision Records (ADRs)
- Code Reviews
- Technical Documentation
- Runbooks
- Postmortems
- Internal Training

Critical knowledge SHALL never depend upon individual contributors alone.

---

# Acknowledgements

The BakeFlow Engineering Bible recognizes the disciplines required to deliver an enterprise-grade ERP platform, including:

- Software Architecture
- Database Architecture
- Mobile Engineering
- Backend Engineering
- Financial Systems Design
- Manufacturing Systems Design
- Cybersecurity Engineering
- DevOps Engineering
- Product Strategy
- User Experience Design

Each discipline contributes to the overall quality and sustainability of the platform.

---

# Engineering Credits

This document represents the consolidated engineering specification for the BakeFlow platform and serves as the official reference for:

- Current Development Teams
- Future Contributors
- Technical Reviewers
- QA Engineers
- Infrastructure Engineers
- Security Engineers
- Product Leadership

Future revisions SHALL acknowledge significant architectural contributions where organizational policy permits.

---

# Future Contributors

Future contributors SHALL:

- Review the Engineering Bible before implementation.
- Follow documented engineering standards.
- Submit architecture changes through governance.
- Maintain documentation alongside code.
- Preserve backward compatibility where practical.

Engineering consistency SHALL outweigh individual preference.

---

# Reference Maintenance

Reference material SHALL be reviewed:

| Reference Type | Frequency |
|----------------|-----------|
| Internal Documents | Every Release |
| Architecture Standards | Annually |
| Security Standards | Quarterly |
| Technology Stack | Annually |
| Coding Standards | Annually |

Reference integrity SHALL be maintained over time.

---

# Engineering Legacy Statement

The BakeFlow Engineering Bible establishes a long-term engineering foundation intended to support:

- Continuous Product Evolution
- Enterprise Growth
- Platform Stability
- Sustainable Development
- Knowledge Transfer
- Future Innovation

The architecture is intended to evolve through disciplined enhancement rather than disruptive replacement.

---

# Final Pre-Publication Checklist

Before final publication verify:

- All chapters completed.
- Cross-references validated.
- Numbering consistent.
- Formatting consistent.
- Revision history updated.
- Version number assigned.
- Approval records completed.
- Publication metadata finalized.
- Certification completed.
- Final review approved.

---

# Validation Checklist

The Final Reference Appendix SHALL verify:

- Engineering references documented.
- Technology stack finalized.
- Related standards identified.
- Engineering culture documented.
- Knowledge preservation strategy defined.
- Acknowledgements completed.
- Engineering credits recorded.
- Contributor guidance documented.
- Reference maintenance established.
- Pre-publication review completed.

The Final Reference Appendix SHALL be completed before the Official Final Closure of the Engineering Bible.

---

END OF CHUNK 41/42

Next:

Chunk 42/42 — Official Final Closure, Engineering Bible Completion Certificate & End of Document

Append this chunk immediately below Chunk 41/42.

================================================================================
ENGINEERING BIBLE

Document ID:
EB-016

Title:
Database Implementation Reference

Total Chunks:
42

Chunk:
42/42

Action:
APPEND TO EXISTING FILE

Filename:
EB-016-Database-Implementation-Reference.md

Append:
YES

Location:
Immediately after Chunk 41/42

Status:
FINAL CHUNK

========================================

# Official Final Closure, Engineering Bible Completion Certificate & End of Document

## Purpose

This final section formally closes the BakeFlow Engineering Bible.

Its completion certifies that the architecture, engineering standards, implementation specifications, governance model, operational framework, and long-term strategy have been comprehensively documented for the BakeFlow platform.

This document establishes the baseline engineering reference for Version 1.0 of BakeFlow.

---

# Engineering Bible Completion Certificate

The undersigned certify that the BakeFlow Engineering Bible has been completed in accordance with the established engineering standards.

Certification confirms that the document includes comprehensive guidance for:

- Platform Architecture
- Database Design
- Mobile Architecture
- Backend Architecture
- Security
- Authentication
- Authorization
- Inventory
- Production
- Sales
- Purchasing
- Finance
- Payroll
- Reporting
- Notifications
- Integrations
- Analytics
- Infrastructure
- Operations
- Governance
- Documentation

This certification authorizes implementation of the BakeFlow platform using this document as the governing engineering specification.

---

# Version Baseline

Official Release:

```text
Engineering Bible

Version 1.0.0
```

Document Status:

```text
Released

Approved

Controlled

Published
```

Future revisions SHALL increment the document version in accordance with the governance process.

---

# Official Engineering Declaration

The BakeFlow Engineering Bible SHALL serve as the authoritative engineering reference for all future platform development.

All implementation SHALL align with the principles documented herein unless superseded by an approved revision.

This document SHALL remain under formal version control throughout the lifecycle of the BakeFlow platform.

---

# Master Engineering Objectives

The BakeFlow platform has been engineered to achieve:

- Enterprise-grade reliability
- Financial integrity
- Secure multi-tenant architecture
- Offline-first mobile capability
- High performance
- Long-term maintainability
- Modular extensibility
- Operational excellence
- Scalable infrastructure
- Continuous evolution

These objectives SHALL remain guiding principles for future development.

---

# Engineering Commitments

Future engineering SHALL remain committed to:

```text
Security

↓

Quality

↓

Reliability

↓

Performance

↓

Maintainability

↓

Scalability

↓

Documentation

↓

Continuous Improvement
```

Engineering decisions SHOULD reinforce these commitments.

---

# Long-Term Architectural Stability

The architecture has been designed to support:

```text
Version 1

↓

Version 2

↓

Version 3

↓

Enterprise Expansion

↓

Global Deployment

↓

Platform Ecosystem
```

Architectural evolution SHALL occur through controlled enhancement rather than disruptive redesign.

---

# Future Revision Policy

Future updates MAY include:

- Additional modules
- Improved security controls
- PostgreSQL enhancements
- Infrastructure modernization
- AI capabilities
- Regulatory updates
- Performance improvements

Every revision SHALL:

- Preserve traceability.
- Maintain governance.
- Update documentation.
- Include version history.
- Undergo certification where required.

---

# Document Preservation

The Engineering Bible SHALL be:

- Version controlled.
- Backed up.
- Archived.
- Audited.
- Protected.

Historical versions SHALL remain available for reference.

---

# Engineering Legacy

This Engineering Bible establishes the foundation upon which BakeFlow will continue to evolve.

It is intended to:

- Accelerate development.
- Reduce implementation ambiguity.
- Improve engineering consistency.
- Preserve architectural integrity.
- Enable sustainable growth.
- Support future contributors.

The document SHALL remain a living engineering asset throughout the product lifecycle.

---

# Official Publication Record

| Property | Value |
|----------|-------|
| Document ID | EB-016 |
| Title | Database Implementation Reference |
| Version | 1.0.0 |
| Status | Published |
| Classification | Confidential |
| Language | English |
| Approval | Engineering Approved |
| Publication State | Official |
| Governance | Active |

---

# Final Engineering Statement

BakeFlow has been architected with the objective of delivering a modern, scalable, secure, and maintainable ERP platform tailored to bakery operations while remaining adaptable for future enterprise growth.

The Engineering Bible captures the engineering intent, implementation guidance, governance framework, and operational standards required to realize that objective.

Successful implementation depends upon continued adherence to the standards and principles documented throughout this Engineering Bible.

---

# Final Certification

The Engineering Bible is hereby declared:

```text
COMPLETE

CERTIFIED

APPROVED

PUBLISHED
```

Version:

```text
1.0.0
```

Implementation of BakeFlow Version 1.0 MAY proceed under the governance of this document.

---

# End of Document

```text
==========================================================

BakeFlow Engineering Bible

EB-016

Database Implementation Reference

Version 1.0.0

Official Engineering Specification

Status:
Published

Classification:
Confidential

© BakeFlow Engineering

END OF DOCUMENT

==========================================================
```

---

# Final Validation Checklist

The Engineering Bible SHALL be considered complete upon verification that:

- All 42 document chunks have been incorporated.
- Document numbering is sequential and complete.
- Cross-references have been reviewed.
- Formatting is consistent throughout.
- Governance information is current.
- Version metadata is accurate.
- Certification sections are complete.
- Publication status is confirmed.
- Revision history is initialized.
- The document has been archived as the Version 1.0 baseline.

This concludes **EB-016 — Database Implementation Reference**.

---

END OF CHUNK 42/42

**DOCUMENT COMPLETE**

========================================