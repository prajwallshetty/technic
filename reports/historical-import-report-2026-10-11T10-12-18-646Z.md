# Technic Technology ERP — Historical Invoice Import Report

- **Execution Mode**: `IMPORT`
- **Execution Timestamp**: 2026-10-11T10:12:17.935Z
- **Duration**: 0.71s
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
| Invoices Qualified as Production-Safe | 0 |
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

### Invoices Rejected / Staged for Manual Verification (81)

| Source PDF | Invoice No. | Date | Customer | Total (₹) | Primary Issues |
| --- | --- | --- | --- | --- | --- |
| `136.pdf` | 136 | 2026-04-02 | PHONE :9448142881 E - Way No. | ₹32155.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '136' already exists in the database. |
| `137.pdf` | 137 | 2026-04-06 | Self | ₹968.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '137' already exists in the database. |
| `138.pdf` | 138 | 2026-04-11 | TECHNIC TECHNOLOGY | ₹13904.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '138' already exists in the database.<br/>• Header total (₹13904) differs from calculated total (₹20027.66) by > ₹2.00. |
| `139.pdf` | 139 | 2026-04-11 | PHONE :9677777879 E - Way No. | ₹13428.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '139' already exists in the database.<br/>• Header total (₹13428) differs from calculated total (₹19955.14) by > ₹2.00. |
| `140.pdf` | 140 | 2026-04-21 | TECHNIC TECHNOLOGY | ₹11703.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '140' already exists in the database.<br/>• Header total (₹11703) differs from calculated total (₹16013.96) by > ₹2.00. |
| `141.pdf` | 141 | 2026-04-23 | TECHNIC TECHNOLOGY | ₹5851.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '141' already exists in the database.<br/>• Header total (₹5851) differs from calculated total (₹8006.99) by > ₹2.00. |
| `142.pdf` | 142 | 2026-04-20 | PHONE :9964355954 E - Way No. | ₹11200.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '142' already exists in the database.<br/>• Header total (₹11200) differs from calculated total (₹17938.96) by > ₹2.00. |
| `143.pdf` | 143 | 2026-04-30 | PHONE :9677777879 E - Way No. | ₹12735.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '143' already exists in the database.<br/>• Header total (₹12735) differs from calculated total (₹17112.04) by > ₹2.00. |
| `144.pdf` | 144 | 2026-05-01 | PHONE :9164195516 E - Way No. | ₹82500.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '144' already exists in the database. |
| `145 Y PRISTAGE.pdf` | 145 | 2026-05-02 | PHONE :9008919195 E - Way No. | ₹51633.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '145' already exists in the database.<br/>• Header total (₹51633) differs from calculated total (₹76164.36) by > ₹2.00. |
| `146.pdf` | 146 | 2026-05-06 | TECHNIC TECHNOLOGY | ₹14415.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '146' already exists in the database.<br/>• Header total (₹14415) differs from calculated total (₹20105.66) by > ₹2.00. |
| `147 ms bat.pdf` | 147 | 2026-05-18 | TECHNIC TECHNOLOGY | ₹14415.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '147' already exists in the database.<br/>• Header total (₹14415) differs from calculated total (₹20105.66) by > ₹2.00. |
| `148.pdf` | 148 | 2026-05-18 | TECHNIC TECHNOLOGY | ₹5068.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '148' already exists in the database.<br/>• Header total (₹5068) differs from calculated total (₹7323.06) by > ₹2.00. |
| `149 shah.pdf` | 149 | 2026-05-18 | PHONE :9164195516 E - Way No. | ₹40000.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '149' already exists in the database. |
| `150 ms batt.pdf` | 150 | 2026-05-19 | TECHNIC TECHNOLOGY | ₹22195.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '150' already exists in the database.<br/>• Header total (₹22195) differs from calculated total (₹30294.1) by > ₹2.00. |
| `151.pdf` | 151 | 2026-05-19 | PHONE :8971412530 E - Way No. | ₹151000.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '151' already exists in the database. |
| `152 ms.pdf` | 152 | 2026-05-20 | TECHNIC TECHNOLOGY | ₹4314.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '152' already exists in the database.<br/>• Header total (₹4314) differs from calculated total (₹6320.77) by > ₹2.00. |
| `153 ms.pdf` | 153 | 2026-05-20 | TECHNIC TECHNOLOGY | ₹5671.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '153' already exists in the database.<br/>• Header total (₹5671) differs from calculated total (₹8359.15) by > ₹2.00. |
| `154 ms.pdf` | 154 | 2026-05-20 | TECHNIC TECHNOLOGY | ₹12900.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '154' already exists in the database.<br/>• Header total (₹12900) differs from calculated total (₹23662.7) by > ₹2.00. |
| `155 ms.pdf` | 155 | 2026-05-21 | TECHNIC TECHNOLOGY | ₹12753.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '155' already exists in the database.<br/>• Header total (₹12753) differs from calculated total (₹16669.02) by > ₹2.00. |
| `156 ms.pdf` | 156 | 2026-05-23 | TECHNIC TECHNOLOGY | ₹6440.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '156' already exists in the database.<br/>• Header total (₹6440) differs from calculated total (₹8344.18) by > ₹2.00. |
| `157.pdf` | 157 | 2026-06-01 | TECHNIC TECHNOLOGY | ₹12024.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '157' already exists in the database. |
| `158.pdf` | 158 | 2026-06-01 | PHONE :9164195516 E - Way No. | ₹102936.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '158' already exists in the database.<br/>• Header total (₹102936) differs from calculated total (₹98518.24) by > ₹2.00. |
| `159.pdf` | 159 | 2026-06-01 | PHONE :9164195516 E - Way No. | ₹111108.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '159' already exists in the database. |
| `160.pdf` | 160 | 2026-06-01 | PHONE :9164195516 E - Way No. | ₹38529.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '160' already exists in the database.<br/>• Header total (₹38529) differs from calculated total (₹39539.14) by > ₹2.00. |
| `161.pdf` | 161 | 2026-06-02 | PHONE :7338175866 E - Way No. | ₹88872.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '161' already exists in the database. |
| `162.pdf` | 162 | 2026-06-02 | PHONE :7338175866 E - Way No. | ₹43141.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '162' already exists in the database.<br/>• Header total (₹43141) differs from calculated total (₹44271.24) by > ₹2.00. |
| `163.pdf` | 163 | 2026-06-02 | PHONE :7338175866 E - Way No. | ₹116782.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '163' already exists in the database.<br/>• Header total (₹116782) differs from calculated total (₹107183.73) by > ₹2.00. |
| `164.pdf` | 164 | 2026-06-02 | PHONE :7338175866 E - Way No. | ₹27304.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '164' already exists in the database.<br/>• Header total (₹27304) differs from calculated total (₹16407.38) by > ₹2.00. |
| `165.pdf` | 165 | 2026-06-03 | PHONE :9164195516 E - Way No. | ₹26059.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '165' already exists in the database.<br/>• Header total (₹26059) differs from calculated total (₹17492.05) by > ₹2.00. |
| `166.pdf` | 166 | 2026-06-03 | TECHNIC TECHNOLOGY | ₹25237.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '166' already exists in the database. |
| `167.pdf` | 167 | 2026-06-06 | TECHNIC TECHNOLOGY | ₹24774.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '167' already exists in the database.<br/>• Header total (₹24774) differs from calculated total (₹13968.92) by > ₹2.00. |
| `168.pdf` | 168 | 2026-06-06 | TECHNIC TECHNOLOGY | ₹19514.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '168' already exists in the database. |
| `169.pdf` | 169 | 2026-06-06 | PHONE :7338175866 E - Way No. | ₹7000.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '169' already exists in the database. |
| `170.pdf` | 170 | 2026-06-08 | PHONE :9164195516 E - Way No. | ₹52549.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '170' already exists in the database.<br/>• Header total (₹52549) differs from calculated total (₹52999.03) by > ₹2.00. |
| `171.pdf` | 171 | 2026-06-10 | PHONE :8971412530 E - Way No. | ₹32359.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '171' already exists in the database.<br/>• Header total (₹32359) differs from calculated total (₹18453.07) by > ₹2.00. |
| `172.pdf` | 172 | 2026-06-11 | PHONE :8971412530 E - Way No. | ₹39999.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '172' already exists in the database.<br/>• Header total (₹39999) differs from calculated total (₹45508.37) by > ₹2.00. |
| `173.pdf` | 173 | 2026-06-16 | PHONE :7338175866 E - Way No. | ₹38612.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '173' already exists in the database. |
| `174.pdf` | 174 | 2026-06-16 | PHONE :9164195516 E - Way No. | ₹52008.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '174' already exists in the database. |
| `175.pdf` | 175 | 2026-06-16 | PHONE :7338175866 E - Way No. | ₹34544.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '175' already exists in the database. |
| `176.pdf` | 176 | 2026-06-24 | PHONE :9164195516 E - Way No. | ₹10800.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '176' already exists in the database. |
| `177.pdf` | 177 | 2026-06-24 | PHONE :9164195516 E - Way No. | ₹26607.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '177' already exists in the database. |
| `178.pdf` | 178 | 2026-06-29 | PHONE :9448257106 E - Way No. | ₹35716.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '178' already exists in the database. |
| `179.pdf` | 179 | 2026-06-29 | PHONE :7338175866 E - Way No. | ₹27975.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '179' already exists in the database. |
| `180.pdf` | 180 | 2026-06-29 | PHONE :8971412530 E - Way No. | ₹15900.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '180' already exists in the database. |
| `181.pdf` | 181 | 2026-06-30 | PHONE :9632269313 E - Way No. | ₹41300.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '181' already exists in the database. |
| `182.pdf` | 182 | 2026-07-02 | PHONE :7338175866 E - Way No. | ₹20075.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '182' already exists in the database. |
| `183.pdf` | 183 | 2026-07-02 | PHONE :9164195516 E - Way No. | ₹34020.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '183' already exists in the database. |
| `184.pdf` | 184 | 2026-07-04 | PHONE :7338175866 E - Way No. | ₹4328.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '184' already exists in the database. |
| `185.pdf` | 185 | 2026-07-04 | PHONE :9164195516 E - Way No. | ₹5782.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '185' already exists in the database. |
| `186.pdf` | 186 | 2026-07-04 | TECHNIC TECHNOLOGY | ₹9873.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '186' already exists in the database.<br/>• Header total (₹9873) differs from calculated total (₹10221.24) by > ₹2.00. |
| `187.pdf` | 187 | 2026-07-04 | TECHNIC TECHNOLOGY | ₹201781.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '187' already exists in the database.<br/>• Header total (₹201781) differs from calculated total (₹185239.56) by > ₹2.00. |
| `188.pdf` | 188 | 2026-07-06 | PHONE :7338175866 E - Way No. | ₹29438.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '188' already exists in the database. |
| `189.pdf` | 189 | 2026-07-09 | TECHNIC TECHNOLOGY | ₹14500.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '189' already exists in the database. |
| `190.pdf` | 190 | 2026-07-09 | PHONE :8971412530 E - Way No. | ₹33900.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '190' already exists in the database. |
| `191.pdf` | 191 | 2026-07-13 | PHONE :7338175866 E - Way No. | ₹19730.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '191' already exists in the database.<br/>• Header total (₹19730) differs from calculated total (₹14899.49) by > ₹2.00. |
| `192.pdf` | 192 | 2026-07-22 | PHONE :9164195516 E - Way No. | ₹41736.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '192' already exists in the database.<br/>• Header total (₹41736) differs from calculated total (₹42275.06) by > ₹2.00. |
| `193.pdf` | 193 | 2026-07-22 | PHONE :9164195516 E - Way No. | ₹22347.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '193' already exists in the database. |
| `194.pdf` | 194 | 2026-07-24 | PHONE :9164195516 E - Way No. | ₹5782.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '194' already exists in the database. |
| `195.pdf` | 195 | 2026-07-27 | PHONE :9964012918 E - Way No. | ₹6360.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '195' already exists in the database. |
| `196.pdf` | 196 | 2026-07-28 | PHONE :9677777879 E - Way No. | ₹14898.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '196' already exists in the database.<br/>• Header total (₹14898) differs from calculated total (₹14421.8) by > ₹2.00. |
| `197.pdf` | 197 | 2026-08-01 | PHONE :9148834224 E - Way No. | ₹9208.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '197' already exists in the database. |
| `198.pdf` | 198 | 2026-08-03 | PHONE :9008919195 E - Way No. | ₹62300.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '198' already exists in the database. |
| `199.pdf` | 199 | 2026-08-03 | PHONE :9035556144 E - Way No. | ₹36535.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '199' already exists in the database. |
| `200.pdf` | 200 | 2026-08-04 | PHONE :7338175866 E - Way No. | ₹36567.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '200' already exists in the database. |
| `201.pdf` | 201 | 2026-08-10 | PHONE :9035556144 E - Way No. | ₹33529.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '201' already exists in the database. |
| `202.pdf` | 202 | 2026-08-10 | PHONE :7618766636 E - Way No. | ₹7548.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '202' already exists in the database. |
| `203.pdf` | 203 | 2026-08-10 | PHONE :9964012918 E - Way No. | ₹6118.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '203' already exists in the database. |
| `204.pdf` | 204 | 2026-08-10 | PHONE :7338175866 E - Way No. | ₹24486.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '204' already exists in the database.<br/>• Header total (₹24486) differs from calculated total (₹20150.42) by > ₹2.00. |
| `205.pdf` | 205 | 2026-08-21 | PHONE :9035556144 E - Way No. | ₹19526.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '205' already exists in the database. |
| `206.pdf` | 206 | 2026-08-21 | PHONE :9448257106 E - Way No. | ₹12613.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '206' already exists in the database.<br/>• Header total (₹12613) differs from calculated total (₹12830.73) by > ₹2.00. |
| `207.pdf` | 207 | 2026-08-24 | PHONE :9964012918 E - Way No. | ₹6550.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '207' already exists in the database. |
| `208.pdf` | 208 | 2026-08-24 | PHONE :7338175866 E - Way No. | ₹6566.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '208' already exists in the database. |
| `209.pdf` | 209 | 2026-08-28 | PHONE :7338175866 E - Way No. | ₹6258.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '209' already exists in the database. |
| `210.pdf` | 210 | 2026-08-28 | PHONE :9164195516 E - Way No. | ₹6876.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '210' already exists in the database. |
| `211.pdf` | 211 | 2026-08-28 | PHONE :9164195516 E - Way No. | ₹20138.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '211' already exists in the database. |
| `212.pdf` | 212 | 2026-08-28 | PHONE :9164195516 E - Way No. | ₹6106.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '212' already exists in the database. |
| `213.pdf` | 213 | 2026-08-29 | PHONE :9008919195 E - Way No. | ₹29000.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '213' already exists in the database.<br/>• Header total (₹29000) differs from calculated total (₹40011.07) by > ₹2.00. |
| `214.pdf` | 214 | 2026-09-03 | PHONE :9964012918 E - Way No. | ₹6550.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '214' already exists in the database. |
| `215.pdf` | 215 | 2026-09-17 | PHONE :9964012918 E - Way No. | ₹4106.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '215' already exists in the database. |
| `216.pdf` | 216 | 2026-09-30 | PHONE :9008919195 E - Way No. | ₹32194.00 | • Invoice is flagged for manual review in source CSV.<br/>• Invoice number '216' already exists in the database.<br/>• Header total (₹32194) differs from calculated total (₹43887.29) by > ₹2.00. |
