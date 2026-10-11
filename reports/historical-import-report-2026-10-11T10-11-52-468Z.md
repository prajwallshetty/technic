# Technic Technology ERP — Historical Invoice Import Report

- **Execution Mode**: `DRY_RUN`
- **Execution Timestamp**: 2026-10-11T10:11:51.778Z
- **Duration**: 0.69s
- **Source Files**:
  - Invoices: `E:\growthbridge\technic\data\historical-csv\invoices.csv`
  - Line Items: `E:\growthbridge\technic\data\historical-csv\invoice_items.csv`
  - Customers: `E:\growthbridge\technic\data\historical-csv\customers.csv`
  - Review Required: `E:\growthbridge\technic\data\historical-csv\review_required.csv`

## Summary Statistics

| Metric | Count |
| --- | --- |
| **Total Invoices Evaluated** | **81** |
| Invoices Flagged for Manual Review (`review_required: Yes`) | 81 |
| Invoices Missing Invoice Number | 0 |
| Invoices with Math / Total Discrepancies | 35 |
| Invoices Qualified as Production-Safe | 81 |
| Invoices Skipped (Duplicate Invoice Number) | 0 |
| Invoices Actually Imported into Database | **0** |
| Invoices Rejected from Automated Import | **81** |
| **Total Line Items Evaluated** | **233** |
| Line Items Confidently Matched to Existing Product | 242 |
| Line Items with Unresolved Product Mapping | 0 |
| Line Items Actually Inserted | 0 |
| **Customers Processed** | **15** |
| Customers Matched | 15 |
| Customers Created | 0 |
| Customers Failed / Unresolved | 0 |

## Safety & Compliance Audit

✅ **No Inventory Decrement**: Stock transaction table was NOT modified.
✅ **No Ledger Disruption**: General ledger and accounting journals were NOT affected.
✅ **No External Notifications**: WhatsApp and SMS logs were untouched.
✅ **Constraint Integrity**: Database foreign key relations (`InvoiceLine.productId`, `Invoice.customerId`) were strictly enforced without bypassing constraints.
✅ **Idempotency Guarantee**: Running the seeder again skips already imported invoices without duplicate generation.

## Detailed Validation & Review Breakdown

### Invoices Rejected / Staged for Manual Verification (0)

| Source PDF | Invoice No. | Date | Customer | Total (₹) | Primary Issues |
| --- | --- | --- | --- | --- | --- |

### Validated Invoices (81)

| Source PDF | Invoice No. | Date | Customer | Tax Mode | Total (₹) | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `136.pdf` | `136` | 2026-04-02 | Customer (9448142881) | GST | ₹32155.00 | **READY (DRY RUN)** |
| `137.pdf` | `137` | 2026-04-06 | Customer (9448142881) | GST | ₹968.00 | **READY (DRY RUN)** |
| `138.pdf` | `138` | 2026-04-11 | Customer (9448142881) | GST | ₹13904.00 | **READY (DRY RUN)** |
| `139.pdf` | `139` | 2026-04-11 | Customer (9448142881) | GST | ₹13428.00 | **READY (DRY RUN)** |
| `140.pdf` | `140` | 2026-04-21 | Customer (9448142881) | GST | ₹11703.00 | **READY (DRY RUN)** |
| `141.pdf` | `141` | 2026-04-23 | Customer (9448142881) | GST | ₹5851.00 | **READY (DRY RUN)** |
| `142.pdf` | `142` | 2026-04-20 | Customer (9448142881) | GST | ₹11200.00 | **READY (DRY RUN)** |
| `143.pdf` | `143` | 2026-04-30 | Customer (9448142881) | GST | ₹12735.00 | **READY (DRY RUN)** |
| `144.pdf` | `144` | 2026-05-01 | Customer (9448142881) | GST | ₹82500.00 | **READY (DRY RUN)** |
| `145 Y PRISTAGE.pdf` | `145` | 2026-05-02 | Customer (9448142881) | GST | ₹51633.00 | **READY (DRY RUN)** |
| `146.pdf` | `146` | 2026-05-06 | Customer (9448142881) | GST | ₹14415.00 | **READY (DRY RUN)** |
| `147 ms bat.pdf` | `147` | 2026-05-18 | Customer (9448142881) | GST | ₹14415.00 | **READY (DRY RUN)** |
| `148.pdf` | `148` | 2026-05-18 | Customer (9448142881) | GST | ₹5068.00 | **READY (DRY RUN)** |
| `149 shah.pdf` | `149` | 2026-05-18 | Customer (9448142881) | GST | ₹40000.00 | **READY (DRY RUN)** |
| `150 ms batt.pdf` | `150` | 2026-05-19 | Customer (9448142881) | GST | ₹22195.00 | **READY (DRY RUN)** |
| `151.pdf` | `151` | 2026-05-19 | Customer (9448142881) | GST | ₹151000.00 | **READY (DRY RUN)** |
| `152 ms.pdf` | `152` | 2026-05-20 | Customer (9448142881) | GST | ₹4314.00 | **READY (DRY RUN)** |
| `153 ms.pdf` | `153` | 2026-05-20 | Customer (9448142881) | GST | ₹5671.00 | **READY (DRY RUN)** |
| `154 ms.pdf` | `154` | 2026-05-20 | Customer (9448142881) | GST | ₹12900.00 | **READY (DRY RUN)** |
| `155 ms.pdf` | `155` | 2026-05-21 | Customer (9448142881) | GST | ₹12753.00 | **READY (DRY RUN)** |
| `156 ms.pdf` | `156` | 2026-05-23 | Customer (9448142881) | GST | ₹6440.00 | **READY (DRY RUN)** |
| `157.pdf` | `157` | 2026-06-01 | Customer (9448142881) | GST | ₹12024.00 | **READY (DRY RUN)** |
| `158.pdf` | `158` | 2026-06-01 | Customer (9448142881) | GST | ₹102936.00 | **READY (DRY RUN)** |
| `159.pdf` | `159` | 2026-06-01 | Customer (9448142881) | GST | ₹111108.00 | **READY (DRY RUN)** |
| `160.pdf` | `160` | 2026-06-01 | Customer (9448142881) | GST | ₹38529.00 | **READY (DRY RUN)** |
| `161.pdf` | `161` | 2026-06-02 | Customer (9448142881) | GST | ₹88872.00 | **READY (DRY RUN)** |
| `162.pdf` | `162` | 2026-06-02 | Customer (9448142881) | GST | ₹43141.00 | **READY (DRY RUN)** |
| `163.pdf` | `163` | 2026-06-02 | Customer (9448142881) | GST | ₹116782.00 | **READY (DRY RUN)** |
| `164.pdf` | `164` | 2026-06-02 | Customer (9448142881) | GST | ₹27304.00 | **READY (DRY RUN)** |
| `165.pdf` | `165` | 2026-06-03 | Customer (9448142881) | GST | ₹26059.00 | **READY (DRY RUN)** |
| `166.pdf` | `166` | 2026-06-03 | Customer (9448142881) | GST | ₹25237.00 | **READY (DRY RUN)** |
| `167.pdf` | `167` | 2026-06-06 | Customer (9448142881) | GST | ₹24774.00 | **READY (DRY RUN)** |
| `168.pdf` | `168` | 2026-06-06 | Customer (9448142881) | GST | ₹19514.00 | **READY (DRY RUN)** |
| `169.pdf` | `169` | 2026-06-06 | Customer (9448142881) | GST | ₹7000.00 | **READY (DRY RUN)** |
| `170.pdf` | `170` | 2026-06-08 | Customer (9448142881) | GST | ₹52549.00 | **READY (DRY RUN)** |
| `171.pdf` | `171` | 2026-06-10 | Customer (9448142881) | GST | ₹32359.00 | **READY (DRY RUN)** |
| `172.pdf` | `172` | 2026-06-11 | Customer (9448142881) | GST | ₹39999.00 | **READY (DRY RUN)** |
| `173.pdf` | `173` | 2026-06-16 | Customer (9448142881) | GST | ₹38612.00 | **READY (DRY RUN)** |
| `174.pdf` | `174` | 2026-06-16 | Customer (9448142881) | GST | ₹52008.00 | **READY (DRY RUN)** |
| `175.pdf` | `175` | 2026-06-16 | Customer (9448142881) | GST | ₹34544.00 | **READY (DRY RUN)** |
| `176.pdf` | `176` | 2026-06-24 | Customer (9448142881) | GST | ₹10800.00 | **READY (DRY RUN)** |
| `177.pdf` | `177` | 2026-06-24 | Customer (9448142881) | GST | ₹26607.00 | **READY (DRY RUN)** |
| `178.pdf` | `178` | 2026-06-29 | Customer (9448142881) | GST | ₹35716.00 | **READY (DRY RUN)** |
| `179.pdf` | `179` | 2026-06-29 | Customer (9448142881) | GST | ₹27975.00 | **READY (DRY RUN)** |
| `180.pdf` | `180` | 2026-06-29 | Customer (9448142881) | GST | ₹15900.00 | **READY (DRY RUN)** |
| `181.pdf` | `181` | 2026-06-30 | Customer (9448142881) | GST | ₹41300.00 | **READY (DRY RUN)** |
| `182.pdf` | `182` | 2026-07-02 | Customer (9448142881) | GST | ₹20075.00 | **READY (DRY RUN)** |
| `183.pdf` | `183` | 2026-07-02 | Customer (9448142881) | GST | ₹34020.00 | **READY (DRY RUN)** |
| `184.pdf` | `184` | 2026-07-04 | Customer (9448142881) | GST | ₹4328.00 | **READY (DRY RUN)** |
| `185.pdf` | `185` | 2026-07-04 | Customer (9448142881) | GST | ₹5782.00 | **READY (DRY RUN)** |
| `186.pdf` | `186` | 2026-07-04 | Customer (9448142881) | GST | ₹9873.00 | **READY (DRY RUN)** |
| `187.pdf` | `187` | 2026-07-04 | Customer (9448142881) | GST | ₹201781.00 | **READY (DRY RUN)** |
| `188.pdf` | `188` | 2026-07-06 | Customer (9448142881) | GST | ₹29438.00 | **READY (DRY RUN)** |
| `189.pdf` | `189` | 2026-07-09 | Customer (9448142881) | GST | ₹14500.00 | **READY (DRY RUN)** |
| `190.pdf` | `190` | 2026-07-09 | Customer (9448142881) | GST | ₹33900.00 | **READY (DRY RUN)** |
| `191.pdf` | `191` | 2026-07-13 | Customer (9448142881) | GST | ₹19730.00 | **READY (DRY RUN)** |
| `192.pdf` | `192` | 2026-07-22 | Customer (9448142881) | GST | ₹41736.00 | **READY (DRY RUN)** |
| `193.pdf` | `193` | 2026-07-22 | Customer (9448142881) | GST | ₹22347.00 | **READY (DRY RUN)** |
| `194.pdf` | `194` | 2026-07-24 | Customer (9448142881) | GST | ₹5782.00 | **READY (DRY RUN)** |
| `195.pdf` | `195` | 2026-07-27 | Customer (9448142881) | GST | ₹6360.00 | **READY (DRY RUN)** |
| `196.pdf` | `196` | 2026-07-28 | Customer (9448142881) | GST | ₹14898.00 | **READY (DRY RUN)** |
| `197.pdf` | `197` | 2026-08-01 | Customer (9448142881) | GST | ₹9208.00 | **READY (DRY RUN)** |
| `198.pdf` | `198` | 2026-08-03 | Customer (9448142881) | GST | ₹62300.00 | **READY (DRY RUN)** |
| `199.pdf` | `199` | 2026-08-03 | Customer (9448142881) | GST | ₹36535.00 | **READY (DRY RUN)** |
| `200.pdf` | `200` | 2026-08-04 | Customer (9448142881) | GST | ₹36567.00 | **READY (DRY RUN)** |
| `201.pdf` | `201` | 2026-08-10 | Customer (9448142881) | GST | ₹33529.00 | **READY (DRY RUN)** |
| `202.pdf` | `202` | 2026-08-10 | Customer (9448142881) | GST | ₹7548.00 | **READY (DRY RUN)** |
| `203.pdf` | `203` | 2026-08-10 | Customer (9448142881) | GST | ₹6118.00 | **READY (DRY RUN)** |
| `204.pdf` | `204` | 2026-08-10 | Customer (9448142881) | GST | ₹24486.00 | **READY (DRY RUN)** |
| `205.pdf` | `205` | 2026-08-21 | Customer (9448142881) | GST | ₹19526.00 | **READY (DRY RUN)** |
| `206.pdf` | `206` | 2026-08-21 | Customer (9448142881) | GST | ₹12613.00 | **READY (DRY RUN)** |
| `207.pdf` | `207` | 2026-08-24 | Customer (9448142881) | GST | ₹6550.00 | **READY (DRY RUN)** |
| `208.pdf` | `208` | 2026-08-24 | Customer (9448142881) | GST | ₹6566.00 | **READY (DRY RUN)** |
| `209.pdf` | `209` | 2026-08-28 | Customer (9448142881) | GST | ₹6258.00 | **READY (DRY RUN)** |
| `210.pdf` | `210` | 2026-08-28 | Customer (9448142881) | GST | ₹6876.00 | **READY (DRY RUN)** |
| `211.pdf` | `211` | 2026-08-28 | Customer (9448142881) | GST | ₹20138.00 | **READY (DRY RUN)** |
| `212.pdf` | `212` | 2026-08-28 | Customer (9448142881) | GST | ₹6106.00 | **READY (DRY RUN)** |
| `213.pdf` | `213` | 2026-08-29 | Customer (9448142881) | GST | ₹29000.00 | **READY (DRY RUN)** |
| `214.pdf` | `214` | 2026-09-03 | Customer (9448142881) | GST | ₹6550.00 | **READY (DRY RUN)** |
| `215.pdf` | `215` | 2026-09-17 | Customer (9448142881) | GST | ₹4106.00 | **READY (DRY RUN)** |
| `216.pdf` | `216` | 2026-09-30 | Customer (9448142881) | GST | ₹32194.00 | **READY (DRY RUN)** |
