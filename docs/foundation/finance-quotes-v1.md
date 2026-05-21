# Finance Quotes v1 — Foundation

This document explains the design decisions behind the Quotes module so future
contributors can navigate the code (and the schema) in five minutes. It pairs
the implementation in `apps/desktop/electron/main/services/data/quote*.ts` and
`apps/desktop/src/features/finance/Quote*.tsx` with the rationale that doesn't
fit in code comments.

## What it ships

A complete client-quote workflow modelled on Metadata Cine's real cotizaciones
(`2025-8400..8405`):

- DOP / USD / EUR pricing with frozen exchange-rate snapshot per quote.
- Flexible ITBIS treatment per quote AND per item (Ley de Cine, ITBIS estándar,
  mixto, manual).
- Quote numbering `YYYY-####` per workspace, sequential per year.
- Metadata-style PDF export (logo, sello, signature, observaciones).
- Templates: 6 hard-coded Metadata packages (DIT/Data Cart, Monitor DIT,
  Editorial Assistance, Recording Monitors, Backup Package, Custom blank).
- Versions snapshot on every save so older quotes never silently mutate.
- Status state machine: `draft → sent → approved/rejected/cancelled`, plus
  automatic `expired` when `valid_until < today` (sweep runs every 12 hours).
- Agent read tools: `search_quotes`, `get_quote_detail`, `explain_quote_total`,
  `prepare_quote_draft`. The agent **never** persists; it can only suggest.

## Money representation

Money is stored as **REAL with 2 decimals** (e.g. `total_amount REAL NOT NULL`)
to stay consistent with the existing `financial_entries` table. We round each
calculation step with `Math.round(x * 100) / 100` to avoid float drift.

`dinero.js@2.0.2` is installed and can be used internally for safer arithmetic
when cases get complex, but we **do not** persist Dinero objects — they get
serialized to REAL via `.toFixed(2)`. Migrating the entire app to integer minor
units is explicitly out of scope for v1; it's tracked as a future holistic
refactor that should also touch finance entries, project budgets and assets.

## Tax model

The quote-level `tax_profile` controls the default behaviour of items whose
`tax_behavior` is `"follows_quote"`:

| Profile             | Item default | Total = subtotal + tax? |
|---------------------|--------------|-------------------------|
| `film_law_exempt`   | `show_only`  | NO (Ley de Cine)        |
| `standard_itbis`    | `taxable`    | YES                     |
| `mixed`             | `exempt`*    | depends on item flags   |
| `manual`            | `show_only`  | NO by default           |

\* `mixed` emits a warning if any item is `follows_quote` — caller is expected
to pin every item explicitly when using this profile.

Per-item override `tax_behavior`:

- `taxable`: adds tax to line total + quote total.
- `exempt`: no ITBIS at all.
- `show_only`: ITBIS computed for transparency (printed on the PDF) but **NOT**
  added to the total.
- `included`: unit price already contains tax. Subtotal is derived as
  `price / (1 + rate)`. The line tax is included in the total regardless of
  the quote-level `taxAddedToTotal` flag.

The `taxAddedToTotal` flag at quote level is the resolved decision — Ley de
Cine and Manual default it to `false`, the rest default to `true`. The PDF
prints `** ITBIS:` (with the asterisk marker) when ITBIS is shown but not
added, exactly as Iván's hand-prepared cotizaciones do (see 2025-8403).

## Currency snapshot

When a quote is created, we capture:

- `currency`, `base_currency`
- `exchange_rate`, `exchange_rate_source`, `exchange_rate_type`,
  `exchange_rate_effective_date`
- `exchange_rate_snapshot_json` (the full source row at creation time)

Older quotes **never change** when the exchange rate is updated later. The
`base_currency_total_amount` is also pre-computed and persisted so the PDF
and the list view always render the same equivalent.

## RNC / PUR / Sirecine

Catalog tables `clients` (workspace-scoped) and `production_companies` got
`rnc` and `pur` columns respectively. Each quote captures snapshot copies
(`client_rnc_snapshot`, `production_pur_snapshot`, `workspace_sirecine_snapshot`)
so editing a catalog row doesn't rewrite history. The PDF always reads from
the snapshot.

Quote Editor now watches the draft for reusable business data. If a typed
client or production company is new — or if an existing catalog row is missing
RNC/PUR/contact/phone — it shows compact inline capture actions inside the
Client & Production section. The user can save that data into Catalog without
leaving the quote flow. This keeps the quote fast to draft while gradually
building the searchable database for future quotes.

## Manual invoice MVP

Invoices can now be created directly from Finance > Invoices through
`/finance/invoices/new`. This path is intentionally scoped to a draft MVP:

- Users can enter client/RNC, production/project context, dates, currency,
  exchange rate, tax profile, ITBIS behavior, notes and line items.
- The editor reuses the existing `CreateInvoiceCommand` and
  `UpdateInvoiceCommand`; there is no new schema or special manual-invoice
  table.
- Draft invoices expose an explicit "Edit draft" action in
  `InvoiceDetailPage`, routed through `/finance/invoices/:invoiceId/edit`.
- Issuing, NCF consumption, PDF export, cancellation and payment registration
  remain in the invoice detail surface so the fiscal lifecycle has one clear
  operational home.
- Issued/paid/cancelled/void invoices are not editable. Corrections should be
  handled by cancelling/reissuing rather than mutating a fiscal snapshot.

The manual path does not replace Quote -> Invoice. Quote-generated invoices
remain the preferred production workflow when a quote exists; manual invoices
cover operational exceptions and historical billing that did not start from a
quote.

## Startup instrumentation

The Electron startup window still appears before the local SQLite bootstrap.
The renderer now uses the same `Starting bukowskiOS` gate while session,
workspace and route bootstrap complete, so slow starts feel intentional instead
of blank. Main process startup logs now include phase durations for:

- local database initialization;
- total startup time before renderer load;
- renderer `did-finish-load`.

This is diagnostic only. Startup performance should be optimized from these
timings rather than guessed.

## Quote numbering

```sql
SELECT COALESCE(MAX(quote_sequence), 0) + 1
FROM quotes
WHERE workspace_id = ? AND quote_year = ?
```

Wrapped in a `BEGIN IMMEDIATE` transaction to avoid races when two quotes are
created concurrently. The constraint `UNIQUE (workspace_id, quote_year,
quote_sequence)` guarantees no collisions even if the SELECT/INSERT race.

`quote_number` is rendered as `${year}-${seq.padStart(4, "0")}`, e.g.
`2026-0001`.

Commercial numbers can be corrected after creation through the explicit
`renumberQuote` command. The command:

- accepts `YYYY-0001` style input and normalizes short sequences such as
  `2026-42` to `2026-0042`;
- runs inside `BEGIN IMMEDIATE`;
- rejects duplicates with the same `(workspace_id, quote_year, quote_sequence)`;
- records a compact quote-version audit entry without rewriting quote content.

Because creation always reads `MAX(quote_sequence) + 1`, a manual correction to
a higher number also advances future quotes naturally. Invoice commercial
numbers follow the same rule through `renumberInvoice`, but NCF/fiscal numbers
remain separate and immutable once issued.

## NCF preflight

Currency Settings evaluates the active NCF series before users issue invoices:

- `missing`: series, next sequence or max sequence is incomplete; issuing is
  blocked.
- `expired`: expiration date is before today; issuing is blocked.
- `exhausted`: next sequence is past max sequence; issuing is blocked.
- `low`: 10 or fewer sequences remain, or remaining stock is at or below 10%;
  issuing is allowed with a warning.
- `expiring`: expiration is within 30 days; issuing is allowed with a warning.
- `ready`: configured, in date and enough sequence stock remains.

`InvoiceDetailPage` shows the same state next to the NCF tile for draft
invoices. The Issue action is disabled only for blocking states, so the user
does not find out about fiscal setup problems after confirming the action. The
date math uses UTC day boundaries to avoid off-by-one warnings across local
timezones.

## PDF layout

`createQuotePdf` in `documentGenerationService.ts` renders the Metadata-style
A4 portrait quote in this order:

1. Logo top-left (140×100 box; falls back to stacked META/DATA/CINE text when
   no logo is uploaded).
2. "COTIZACIÓN" + quote number top-right.
3. Black header bar with workspace legal name + RNC + Sirecine.
4. Address block (left) + client form (right, 4×2 fields).
5. Section title (uppercase package title) + "VALIDITY: N DAYS".
6. Items table with 5 columns: Cant. | Descripción | Duración | Precio | Costo.
   Short quotes keep the historical single-page shape with empty rows filling
   the remaining table area. Long quotes now continue onto additional pages
   with repeated table headers; we never delete overflow pages or drop line
   items just to preserve the old template.
7. Totals: SUB-TOTAL → optional discount → ITBIS (with `**` marker if not
   added) → TOTAL GENERAL.
8. Observaciones + signature image + sello + signatory name + "Recibido por:".

Invoice PDFs use the newer operational finance layout: logo + fiscal header,
client/document panels, a paginated item table, totals, observations, payments
and a verification footer. Export dialogs suggest human-readable filenames
using commercial number + client, not internal ids.

Branding assets (logo, sello, firma) live in the public Supabase Storage
bucket `workspace-assets`, with RLS gated by the `currency.manage_rates`
permission. The renderer uploads via `WorkspaceBrandingCard`; the main
process fetches the URLs as Buffers when generating the PDF.

If a workspace-specific logo is unavailable or fails to load, quote and
invoice PDFs fall back to the same bundled Metadata Cine logo used by packing
slips. This keeps exported commercial documents branded even before workspace
branding is configured.

Long-document audit: quotes, invoices, packing slips, insurance lists, finance
reports and project setup PDFs all use page-addition paths instead of removing
overflow pages. Quotes were hardened specifically because the older
pixel-faithful template forced a single page; long quotes now paginate with a
continuation header and repeated table header.

## Sync (Plan L FQ7)

- **Outbound**: every mutation service emits a `sync_outbox` row with
  `entity_type` in `'quote'`, `'currency_settings'`, `'exchange_rate'`. The
  existing sync-outbox worker pushes them to Supabase.
- **Inbound** (catalog pull): the `useCatalogPull` hook polls Supabase every
  60 s for new exchange rates (and the catalog tables it already covered)
  and applies them to local SQLite via IPC. Conflict resolution is LWW with
  an outbox guard — local pending edits always win until they reach remote.
- **Quotes are NOT pulled automatically**: drafts may have unsaved local
  edits. Users refresh manually if they need to see another teammate's
  freshly-saved quote. This is intentional and documented.

## Expiration sweep

`quoteMutationService.expireOverdueQuotes(workspaceId, asOf?)` sets every
`draft`/`sent` quote whose `valid_until < asOf` to `expired`. It runs:

- once at startup (catches up on quotes that aged out while the app was
  closed);
- every 12 hours via `setInterval` in the same worker that runs data
  retention.

## Permissions

| Key                         | What it gates                                   |
|-----------------------------|--------------------------------------------------|
| `quotes.read`               | View workspace quotes (read service)             |
| `quotes.create`             | Create new quotes                                |
| `quotes.edit`               | Edit drafts, save new versions                   |
| `quotes.approve`            | Approve / reject sent quotes                     |
| `quotes.cancel`             | Cancel or hard-delete drafts/cancelled/rejected  |
| `quotes.export`             | Generate PDFs                                    |
| `quotes.manage_templates`   | Create / edit DB-backed templates (future)       |
| `currency.manage_rates`     | Edit currency settings + exchange rates + branding|

All seven `quotes.*` permissions are auto-assigned to the admin role of every
workspace via `20260504110000_quote_permissions.sql`. They are read-only at
the cache layer — granting them at runtime requires a workspace settings
change or a new RLS migration.

## Templates

V1 ships **6 in-memory templates** in `apps/desktop/src/features/finance/quoteTemplates.ts`.
Templates pre-fill: `package_title`, `tax_profile`, `taxAddedToTotal`, plus
the items array.

The DB table `quote_templates` exists in both SQLite (0019) and Supabase
(20260504100000) but is not used by the v1 UI. It's there so a follow-up can
add user-editable templates without a schema change. When that happens, seed
the 6 hard-coded templates per workspace at first arrival, then let the user
edit/add via a `WorkspaceSettingsPage` card gated by `quotes.manage_templates`.

## Out of scope for v1

- Hard refactor of `financial_entries` to integer minor units.
- Live exchange-rate fetching from Banco Popular / Banco Central.
- Sending quotes via WhatsApp / Email / SMS (depends on Channels).
- Client approval portal.
- PDF cryptographic signature.
- Bank reconciliation / payment links / invoicing.

## Test coverage

| File                                            | What it covers                              |
|-------------------------------------------------|----------------------------------------------|
| `quote-calculation-service.test.ts`             | Pure tax math: 10 cases (Ley de Cine, ITBIS, mixed, included, discounts, USD/DOP). |
| `quote-mutation-service.test.ts`                | Create / numbering / status transitions / duplicate / expire. |
| `quote-read-service.test.ts`                    | List filters (status, search, date), detail null path, workspace scoping. |
| `quote-pdf.test.ts`                             | PDF buffer non-empty, magic header, currency labels, Ley de Cine + discount paths. |
| `currency-mutation-service.test.ts`             | Settings upsert, rate ordering, validation, idempotent delete. |

Run with `npx vitest run quote-` to scope just the quotes suite.
