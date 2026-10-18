# Technic Technologies — Electronics ERP

A production-ready, multi-branch electronics retail ERP built for Technic Technologies: point-of-sale billing, serial/IMEI tracking, GST & non-GST invoicing, purchases, inventory, warranty and role-based administration — in one web app.

## Feature Overvie

- **6-digit access-code login** (no passwords) with per-role permissions and full audit trail
- **Firm selection & dual access modes** — GST mode (Tax Invoices) and Non-GST mode (retail bills), each unlocked with its own secure access code; document numbering is per firm + mode + financial year
- **Point of Sale** — catalogue search, cart with live GST-inclusive tax preview, serial/IMEI capture, credit-limit checks, instant payment
- **Invoices** — Tax Invoice / Non-GST Bill, per-invoice PDF, partial payments, cancellation with automatic stock & serial reversal
- **Quotations → Sales Orders → Invoices** — one-click conversion chain
- **Sales returns & refunds** — approval workflow, exact serial return, automatic refund receipt
- **Purchases** — supplier orders, goods receipts with serial registration, supplier bills & payables, purchase returns
- **Inventory** — transaction-driven stock ledger (no silent stock edits), low-stock alerts, adjustments with reasons, inter-branch transfers
- **Serial/IMEI lifecycle** — purchase → stock → sale → return → warranty, with a complete per-unit history
- **Warranty** — auto-created on sale; lookup by serial, IMEI, invoice or customer phone; claim/replace statuses
- **Customers & suppliers** — outstanding balances, credit limits, advances and refunds in one payment ledger
- **Expenses** with approval workflow
- **Reports & exports** — dashboard KPIs, GST summary, CSV export on every major list
- **Administration** — users, roles & 52 granular permissions, firms, access codes, settings, audit logs

## Tech Stack

| Layer      | Technology |
|------------|------------
| Framework  | Next.js 16 (App Router, Server Actions) + React 19 + TypeScript |
| Styling    | Tailwind CSS 4 + shadcn/ui-style components |
| Database   | PostgreSQL 14+ (Neon-compatible) via Prisma 7 |
| Auth       | NextAuth v5 (credentials = 6-digit staff access code) |
| Documents  | PDFKit (server-side branded PDFs) |

## Quick Start

### 1. Prerequisites

- Node.js 20+
- A PostgreSQL 14+ database (local, Neon, Supabase or RDS)

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL="postgresql://user:password@host:5432/technic_erp?schema=public"
AUTH_SECRET="<openssl rand -base64 32>"
NEXTAUTH_URL="http://localhost:3000"
APP_NAME="Technic Technologies ERP"
```

### 3. Install, migrate & seed

```bash
npm install
npx prisma migrate deploy     # create all tables
npm run db:seed               # firm, branches, users, catalogue, demo data
```

### 4. Run

```bash
npm run dev                   # development on http://localhost:3000
# or
npm run build && npm start    # production
```

## First Login

Sign in with any seeded staff code, then pick the firm and enter the shop.

| Role | Code |
|------|------|
| Super Admin (full view) | `900001` |
| GST Reconciliation Admin (GST-only view) | `900000` |
| Manager | `900002` |
| Accountant | `900003` |
| Sales Staff | `900004` |
| Purchase Staff | `900005` |
| Inventory Manager | `900006` |
| Sales (branch B) | `900007` |
| Viewer | `900008` |

> **Change or delete these demo codes before going live** (Administration → Users).

The **GST Reconciliation Admin** (`900000`) operates in a GST-only reporting view: non-GST transactions are filtered out of every screen, search, report and export for that user. All other roles see the complete transaction stream. The view is a property of the user record and can be changed by a Super Admin.

## Production Checklist

- [ ] Replace all 8 demo access codes with real staff codes
- [ ] Rotate both firm access codes (they ship in the seed for demo convenience)
- [ ] Set a strong `AUTH_SECRET` and serve over HTTPS
- [ ] Point `NEXTAUTH_URL` at the production domain
- [ ] Schedule `pg_dump` backups (or enable your provider's automated backups)
- [ ] Review role permissions for your staff (default matrix follows the handover spec)

## Useful Scripts

```bash
npm run db:seed        # reset & reseed demo data (clears business tables first)
npm run db:studio      # Prisma Studio data browser
npx tsc --noEmit       # typecheck
```

## Bulk Invoice Import

**Purchasing → Invoice Import** takes invoice PDFs, scans or ZIP archives (nested archives are opened; identical files are imported once). Each document is read from its PDF text layer, or by OCR when there is none (requires the Tesseract and Poppler `pdftoppm` binaries; set `OCR_TESSERACT_CMD` / `OCR_PDFTOPPM_CMD` if they are not on `PATH`). It is then parsed, reconciled against an independent recalculation of its totals, matched to the catalogue and queued for review.

- Nothing is guessed: unreadable values stay empty and are flagged; fuzzy product matches are suggestions that a reviewer must confirm (confirmed matches are remembered per supplier).
- Approval never moves stock or posts money. Supplier invoices become **draft purchase orders** (stock moves only when goods are received). Sales invoices issued by the firm are kept as approved records.
- Every correction, acknowledgement, approval and rejection is in the audit log.
- Permissions: `invoice_import.view`, `invoice_import.manage`, `invoice_import.approve` — run `npm run db:sync-permissions` after deploying.

```bash
npm run invoice-import:report -- --source path/to/invoices.zip   # offline extraction report (CSV/JSON) — no DB writes
npm run invoice-import:worker                                     # drain the processing queue from the CLI
npm run test:invoice-import                                       # unit + real-invoice + PGlite integration tests
```

Uploaded documents and reports contain customer data: they are stored in the database and `reports/invoice-import/` (git-ignored) and are never served from `public/`.

## Project Layout

```
src/app/(app)/     Feature modules (pos, invoices, purchases, inventory, ...)
src/lib/services/  Business logic — all rules enforced server-side
src/lib/pdf/       Branded PDF document templates
prisma/            Schema, migrations, seed
```

## Support

Built for Technic Technologies Pvt Ltd, Bengaluru. See `ERP_IMPLEMENTATION_PROGRESS.md`
for the verification log against the original handover requirements.
