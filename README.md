# Personal Finance System

A personal finance system built to get the reports that off-the-shelf finance apps
don't provide. It is a hobby / personal-use project: no monetization is planned, and
the design deliberately avoids any recurring cost (hosted databases, servers, paid
services).

## Motivation

I've used commercial finance-tracking apps for a while, but their built-in reports
don't answer the questions I actually have about my own money — custom breakdowns by
category/subcategory, cross-account views, credit card statement impact on monthly
balances, etc. Rather than working around that limitation, the goal is to own the
data and the reporting layer.

## Goals

- Accurate day-to-day tracking of accounts, cards, and transactions.
- Flexible, personal-report generation that isn't limited by a third-party app's UI.
- Data ownership: everything lives on my own device(s), in a format I control.
- Ability to import the transaction history already accumulated in the app I use
  today.

## Focus

- **Daily use on mobile** (Android or iPhone) — entering transactions, checking
  balances, quick lookups.
- **Reporting on desktop** — the heavier, more flexible analysis work happens on a
  bigger screen, where custom reports and views make more sense.
- **No paid infrastructure** — no managed databases, no cloud hosting, no
  subscriptions. Whatever is chosen must be able to run for free, indefinitely.

### Non-goals (for now)

- Multi-tenant / SaaS deployment.
- Bank/open-finance integrations or automatic transaction import from institutions.
- Anything that requires an always-on server to function day to day.

## Architecture

### High-level shape

- **Local-first data**: the database lives on the user's device. There is no
  central server requirement for the app to work.
- **Future sync**: the local-first constraint is designed to allow (not require) a
  future network-based synchronization mechanism between a user's own devices
  (e.g. phone ↔ desktop), and potentially a lightweight web service down the line.
- **Shared backend logic**: the desire to avoid rewriting the same business logic
  twice (once for mobile, once for desktop) is the main driver behind evaluating
  **Electron** as a way to reuse one backend/codebase across both a desktop app and,
  eventually, a mobile shell — with a future web service as another possible
  consumer of that same backend.

This is the current direction, not a locked-in decision — the stack is still open to
change if a better fit for these constraints (local-first, free, cross-platform)
turns up while the database and backend layers are being designed.

### Backend layering (MVC)

The backend follows an MVC-style layering, chosen for being the most familiar and
easiest to reason about pattern for this kind of CRUD-and-reports application:

| Layer | Responsibility |
|---|---|
| **Request** | Validates permissions and incoming form/request data before it reaches business logic. |
| **Controller** | Receives requests, delegates to the service layer, shapes and returns responses. |
| **Service** | Owns all business logic (balance calculations, statement rollups, category rules, etc.). |
| **Repository** | Owns all data access/queries — the only layer that talks to the database. |
| **Model** | The object classes representing the domain (User, Account, Transaction, Card, Statement, ...). |

### Domain overview

The system follows the shape common to most personal finance tools:

- A **User** owns one or more **Accounts**.
- Each **Account** tracks monthly **expenses**, **income**, **transfers**, and
  **investments** — collectively modeled as **Transactions**.
- Every transaction has a name, description, amount, category, subcategory, and an
  associated account.
- Each transaction *type* adds its own attributes on top of that shared base — e.g.
  a credit card expense links to a **Statement**, a transfer has a destination
  account, an investment may track an instrument/position, etc. (Exact per-type
  attributes are to be defined during database design.)
- **Accounts** may have **Credit** or **Debit Cards**. Card activity rolls up into
  monthly **Statements**, which in turn factor into the owning account's monthly
  balance.

## Technology Choices

The database is settled. The rest of the stack is still open to revision.

### Database — SQLite

**SQLite**, stored as a single file on the user's device. This is the one piece of the
stack that is locked in, and it was chosen precisely because it does not constrain the
choices that are still open:

- **It is already present on every target platform.** Android and iOS both ship
  SQLite, so whichever mobile technology gets picked later can open the same schema.
  The mobile decision cannot invalidate the data model.
- **It fits the reporting goal.** The reports this project exists to produce are
  relational and month-oriented; window functions and CTEs turn running balances and
  month-over-month comparisons into ordinary queries rather than application code.
- **Data ownership becomes literal** — one file to copy, back up and inspect with any
  of a hundred tools, in a format committed to staying readable for decades. For a
  financial archive meant to span years, that longevity is the point.
- **Zero infrastructure and zero recurring cost**, permanently.
- **Sync stays reachable** without changing engines later.

One consequence worth stating up front: the schema is identical across platforms, but
the SQLite *driver* is not — a desktop shell and a mobile shell use different bindings
with different APIs. The Repository layer is therefore written against a narrow
internal port with a thin platform-specific adapter behind it, so the SQL stays shared
and only the adapter is rewritten.

Full reasoning, the alternatives that were rejected, and the type and configuration
conventions live in **[docs/plans/database-design.md](docs/plans/database-design.md)**,
which is the home for every database decision in the project.

### Still open

- **Electron** as the leading candidate for the desktop shell, primarily to reuse a
  single backend implementation across desktop and (eventually) mobile, and to keep
  the door open to exposing that same backend as a web service later.
- Mobile app technology (native vs. cross-platform) is still to be decided, guided
  by how well it can share code/logic with the desktop backend. Note that Electron
  does not itself run on mobile — reuse in practice means a wrapper such as Capacitor
  or Tauri, or sharing logic rather than UI with a native shell.

## Diagrams

Architecture and design diagrams are produced with [draw.io](https://draw.io) and kept
under [docs/drawio/](docs/drawio/). The entity relationship diagram in
[project.drawio](docs/drawio/project.drawio) is the visual source of truth for the data
model; [docs/plans/database-design.md](docs/plans/database-design.md) carries the
reasoning behind it. When the two disagree, both get updated.

## Status

Early design phase. The database engine is chosen and the schema is fully specified —
entities, types, constraints, foreign-key actions and indexes — in
[docs/plans/database-design.md](docs/plans/database-design.md), and transcribed into
the first migration, [db/migrations/0001_initial_schema.sql](db/migrations/0001_initial_schema.sql).
Application stack decisions are the next step.
