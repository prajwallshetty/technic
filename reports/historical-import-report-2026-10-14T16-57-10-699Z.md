# Technic Technology ERP — Historical Invoice Import Report

- **Execution Mode**: `DRY_RUN`
- **Execution Timestamp**: 2026-10-14T16:57:03.714Z
- **Duration**: 6.99s
- **Source Files**:
  - Invoices: `E:\growthbridge\technic\data\historical-csv\invoices.csv`
  - Line Items: `E:\growthbridge\technic\data\historical-csv\invoice_items.csv`
  - Customers: `E:\growthbridge\technic\data\historical-csv\customers.csv`
  - Review Required: `E:\growthbridge\technic\data\historical-csv\review_required.csv`

## Summary Statistics

| Metric | Count |
| --- | --- |
| **Total Invoices Evaluated** | **81** |
| Invoices Flagged for Manual Review (`review_required: Yes`) | 0 |
| Invoices Missing Invoice Number | 0 |
| Invoices with Math / Total Discrepancies | 0 |
| Invoices Qualified as Production-Safe | 81 |
| Invoices Skipped (Duplicate Invoice Number) | 0 |
| Invoices Actually Imported into Database | **0** |
| Invoices Rejected from Automated Import | **81** |
| **Total Line Items Evaluated** | **262** |
| Line Items Confidently Matched to Existing Product | 262 |
| Line Items with Unresolved Product Mapping | 0 |
| Line Items Actually Inserted | 0 |
| **Customers Processed** | **16** |
| Customers Matched | 1 |
| Customers Created | 15 |
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
| `138.pdf` | `138` | 2026-04-11 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹13904.00 | **READY (DRY RUN)** |
| `139.pdf` | `139` | 2026-04-11 | EVERGREEN TRADERS (9677777879) | GST | ₹13428.00 | **READY (DRY RUN)** |
| `140.pdf` | `140` | 2026-04-21 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹11703.00 | **READY (DRY RUN)** |
| `141.pdf` | `141` | 2026-04-23 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹5851.00 | **READY (DRY RUN)** |
| `142.pdf` | `142` | 2026-04-20 | RE CARE (9964355954) | GST | ₹11200.00 | **READY (DRY RUN)** |
| `143.pdf` | `143` | 2026-04-30 | EVERGREEN TRADERS (9677777879) | GST | ₹12735.00 | **READY (DRY RUN)** |
| `144.pdf` | `144` | 2026-05-01 | SHAH ENTERPRISES (9164195516) | GST | ₹82500.00 | **READY (DRY RUN)** |
| `145 Y PRISTAGE.pdf` | `145` | 2026-05-02 | YOUR PRESTIGE (9008919195) | GST | ₹51633.00 | **READY (DRY RUN)** |
| `146.pdf` | `146` | 2026-05-06 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹14415.00 | **READY (DRY RUN)** |
| `147 ms bat.pdf` | `147` | 2026-05-18 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹14415.00 | **READY (DRY RUN)** |
| `148.pdf` | `148` | 2026-05-18 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹5068.00 | **READY (DRY RUN)** |
| `149 shah.pdf` | `149` | 2026-05-18 | SHAH ENTERPRISES (9164195516) | GST | ₹40000.00 | **READY (DRY RUN)** |
| `150 ms batt.pdf` | `150` | 2026-05-19 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹22195.00 | **READY (DRY RUN)** |
| `151.pdf` | `151` | 2026-05-19 | CILICON MOBILE (8971412530) | GST | ₹151000.00 | **READY (DRY RUN)** |
| `152 ms.pdf` | `152` | 2026-05-20 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹4314.00 | **READY (DRY RUN)** |
| `153 ms.pdf` | `153` | 2026-05-20 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹5671.00 | **READY (DRY RUN)** |
| `154 ms.pdf` | `154` | 2026-05-20 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹12900.00 | **READY (DRY RUN)** |
| `155 ms.pdf` | `155` | 2026-05-21 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹12753.00 | **READY (DRY RUN)** |
| `156 ms.pdf` | `156` | 2026-05-23 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹6440.00 | **READY (DRY RUN)** |
| `157.pdf` | `157` | 2026-06-01 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹12024.00 | **READY (DRY RUN)** |
| `158.pdf` | `158` | 2026-06-01 | SHAH ENTERPRISES (9164195516) | GST | ₹102936.00 | **READY (DRY RUN)** |
| `159.pdf` | `159` | 2026-06-01 | SHAH ENTERPRISES (9164195516) | GST | ₹111108.00 | **READY (DRY RUN)** |
| `160.pdf` | `160` | 2026-06-01 | SHAH ENTERPRISES (9164195516) | GST | ₹38529.00 | **READY (DRY RUN)** |
| `161.pdf` | `161` | 2026-06-02 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹88872.00 | **READY (DRY RUN)** |
| `162.pdf` | `162` | 2026-06-02 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹43141.00 | **READY (DRY RUN)** |
| `163.pdf` | `163` | 2026-06-02 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹116782.00 | **READY (DRY RUN)** |
| `164.pdf` | `164` | 2026-06-02 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹27304.00 | **READY (DRY RUN)** |
| `165.pdf` | `165` | 2026-06-03 | SHAH ENTERPRISES (9164195516) | GST | ₹26059.00 | **READY (DRY RUN)** |
| `166.pdf` | `166` | 2026-06-03 | SAMRUDDHI ENTERPRISES (9845012342) | GST | ₹25237.00 | **READY (DRY RUN)** |
| `167.pdf` | `167` | 2026-06-06 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹24774.00 | **READY (DRY RUN)** |
| `168.pdf` | `168` | 2026-06-06 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹19514.00 | **READY (DRY RUN)** |
| `169.pdf` | `169` | 2026-06-06 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹7000.00 | **READY (DRY RUN)** |
| `170.pdf` | `170` | 2026-06-08 | SHAH ENTERPRISES (9164195516) | GST | ₹52549.00 | **READY (DRY RUN)** |
| `171.pdf` | `171` | 2026-06-10 | CILICON MOBILE (8971412530) | GST | ₹32359.00 | **READY (DRY RUN)** |
| `172.pdf` | `172` | 2026-06-11 | CILICON MOBILE (8971412530) | GST | ₹39999.00 | **READY (DRY RUN)** |
| `173.pdf` | `173` | 2026-06-16 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹38612.00 | **READY (DRY RUN)** |
| `174.pdf` | `174` | 2026-06-16 | SHAH ENTERPRISES (9164195516) | GST | ₹52008.00 | **READY (DRY RUN)** |
| `175.pdf` | `175` | 2026-06-16 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹34544.00 | **READY (DRY RUN)** |
| `176.pdf` | `176` | 2026-06-24 | SHAH ENTERPRISES (9164195516) | GST | ₹10800.00 | **READY (DRY RUN)** |
| `177.pdf` | `177` | 2026-06-24 | SHAH ENTERPRISES (9164195516) | GST | ₹26607.00 | **READY (DRY RUN)** |
| `178.pdf` | `178` | 2026-06-29 | SOORYA ENTERPRISES (9448257106) | GST | ₹35716.00 | **READY (DRY RUN)** |
| `179.pdf` | `179` | 2026-06-29 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹27975.00 | **READY (DRY RUN)** |
| `180.pdf` | `180` | 2026-06-29 | CILICON MOBILE (8971412530) | GST | ₹15900.00 | **READY (DRY RUN)** |
| `181.pdf` | `181` | 2026-06-30 | CREATIVE TOUCH (9632269313) | GST | ₹41300.00 | **READY (DRY RUN)** |
| `182.pdf` | `182` | 2026-07-02 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹20075.00 | **READY (DRY RUN)** |
| `183.pdf` | `183` | 2026-07-02 | SHAH ENTERPRISES (9164195516) | GST | ₹34020.00 | **READY (DRY RUN)** |
| `184.pdf` | `184` | 2026-07-04 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹4328.00 | **READY (DRY RUN)** |
| `185.pdf` | `185` | 2026-07-04 | SHAH ENTERPRISES (9164195516) | GST | ₹5782.00 | **READY (DRY RUN)** |
| `186.pdf` | `186` | 2026-07-04 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹9873.00 | **READY (DRY RUN)** |
| `187.pdf` | `187` | 2026-07-04 | M S AUTO ELECTRICALS WORKS (9845012341) | GST | ₹201781.00 | **READY (DRY RUN)** |
| `188.pdf` | `188` | 2026-07-06 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹29438.00 | **READY (DRY RUN)** |
| `189.pdf` | `189` | 2026-07-09 | APOLLO ELECTRICALS (9845012343) | GST | ₹14500.00 | **READY (DRY RUN)** |
| `190.pdf` | `190` | 2026-07-09 | CILICON MOBILE (8971412530) | GST | ₹33900.00 | **READY (DRY RUN)** |
| `191.pdf` | `191` | 2026-07-13 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹19730.00 | **READY (DRY RUN)** |
| `192.pdf` | `192` | 2026-07-22 | SHAH ENTERPRISES (9164195516) | GST | ₹41736.00 | **READY (DRY RUN)** |
| `193.pdf` | `193` | 2026-07-22 | SHAH ENTERPRISES (9164195516) | GST | ₹22347.00 | **READY (DRY RUN)** |
| `194.pdf` | `194` | 2026-07-24 | SHAH ENTERPRISES (9164195516) | GST | ₹5782.00 | **READY (DRY RUN)** |
| `195.pdf` | `195` | 2026-07-27 | NEW WELCOME AUTO WORKS AND SPARES (9964012918) | GST | ₹6360.00 | **READY (DRY RUN)** |
| `196.pdf` | `196` | 2026-07-28 | EVERGREEN TRADERS (9677777879) | GST | ₹14898.00 | **READY (DRY RUN)** |
| `197.pdf` | `197` | 2026-08-01 | ASIAN POWER SYSTEM (9148834224) | GST | ₹9208.00 | **READY (DRY RUN)** |
| `198.pdf` | `198` | 2026-08-03 | YOUR PRESTIGE (9008919195) | GST | ₹62300.00 | **READY (DRY RUN)** |
| `199.pdf` | `199` | 2026-08-03 | SILICON ENTERPRISES (9035556144) | GST | ₹36535.00 | **READY (DRY RUN)** |
| `200.pdf` | `200` | 2026-08-04 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹36567.00 | **READY (DRY RUN)** |
| `201.pdf` | `201` | 2026-08-10 | SILICON ENTERPRISES (9035556144) | GST | ₹33529.00 | **READY (DRY RUN)** |
| `202.pdf` | `202` | 2026-08-10 | TVS KADABA ADIGA MOTORS (7618766636) | GST | ₹7548.00 | **READY (DRY RUN)** |
| `203.pdf` | `203` | 2026-08-10 | NEW WELCOME AUTO WORKS AND SPARES (9964012918) | GST | ₹6118.00 | **READY (DRY RUN)** |
| `204.pdf` | `204` | 2026-08-10 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹24486.00 | **READY (DRY RUN)** |
| `205.pdf` | `205` | 2026-08-21 | SILICON ENTERPRISES (9035556144) | GST | ₹19526.00 | **READY (DRY RUN)** |
| `206.pdf` | `206` | 2026-08-21 | SOORYA ENTERPRISES (9448257106) | GST | ₹12613.00 | **READY (DRY RUN)** |
| `207.pdf` | `207` | 2026-08-24 | NEW WELCOME AUTO WORKS AND SPARES (9964012918) | GST | ₹6550.00 | **READY (DRY RUN)** |
| `208.pdf` | `208` | 2026-08-24 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹6566.00 | **READY (DRY RUN)** |
| `209.pdf` | `209` | 2026-08-28 | MA UNIVERSAL BATTERY (7338175866) | GST | ₹6258.00 | **READY (DRY RUN)** |
| `210.pdf` | `210` | 2026-08-28 | SHAH ENTERPRISES (9164195516) | GST | ₹6876.00 | **READY (DRY RUN)** |
| `211.pdf` | `211` | 2026-08-28 | SHAH ENTERPRISES (9164195516) | GST | ₹20138.00 | **READY (DRY RUN)** |
| `212.pdf` | `212` | 2026-08-28 | SHAH ENTERPRISES (9164195516) | GST | ₹6106.00 | **READY (DRY RUN)** |
| `213.pdf` | `213` | 2026-08-29 | YOUR PRESTIGE (9008919195) | GST | ₹29000.00 | **READY (DRY RUN)** |
| `214.pdf` | `214` | 2026-09-03 | NEW WELCOME AUTO WORKS AND SPARES (9964012918) | GST | ₹6550.00 | **READY (DRY RUN)** |
| `215.pdf` | `215` | 2026-09-17 | NEW WELCOME AUTO WORKS AND SPARES (9964012918) | GST | ₹4106.00 | **READY (DRY RUN)** |
| `216.pdf` | `216` | 2026-09-30 | YOUR PRESTIGE (9008919195) | GST | ₹32194.00 | **READY (DRY RUN)** |
