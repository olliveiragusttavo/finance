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

Nothing here is final — the whole stack is open to revision as the database and
backend design progress. Current thinking:

- **Electron** as the leading candidate for the desktop shell, primarily to reuse a
  single backend implementation across desktop and (eventually) mobile, and to keep
  the door open to exposing that same backend as a web service later.
- **Local, embedded database** (specific engine TBD) — no external DB server, so the
  app has zero always-on infrastructure and zero recurring cost. Whatever is chosen
  must support an eventual sync story between devices.
- Mobile app technology (native vs. cross-platform) is still to be decided, guided
  by how well it can share code/logic with the desktop backend.

## Diagrams

Architecture and design diagrams will be produced with [draw.io](https://draw.io) and
kept under [drawio/](drawio/). Diagramming is the **last** step of this phase — no
diagrams will be created until the architecture and database design are settled.

## Status

Early design phase: goals and high-level architecture are being defined, and the
database schema is the next concrete step.
