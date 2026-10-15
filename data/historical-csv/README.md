# Historical Invoice Data Directory

This directory contains historical invoice extraction CSV files for Technic Technology ERP:

- `invoices.csv`: Header records for historical invoices.
- `invoice_items.csv`: Line item records linked by `source_pdf` (or `invoice_number`).
- `customers.csv`: Customer candidate master data.
- `review_required.csv`: Preliminary extraction records flagged for manual review.

## Security Notice

These files are located in `data/historical-csv/` (outside `public/`) to ensure sensitive customer, pricing, and invoice details are never exposed to public HTTP requests.

## How the Seeder Works

The historical seeder (`npm run seed:historical`) is a production-safe, idempotent ingestion engine:

1. **Validation & Review Gate**: Any record where `review_required == 'Yes'`, or `invoice_number` is missing, or `productId` cannot be resolved is **safely rejected from automated import** and output to the validation review report (`reports/historical-import-report.md`).
2. **Product Matching**: Adheres to strict matching by SKU or explicit mapping. Items with unknown products are not guessed by name.
3. **Inventory & Accounting Safety**: Zero stock deductions and zero accounting journal adjustments are made for historical records.

## Providing Product Mappings

If battery products (e.g. `YOKOHAMA MTZ4L`) have corresponding SKUs in the catalog, create `data/historical-csv/product-mappings.json`:

```json
{
  "YOKOHAMA MTZ4L": "YOKO-MTZ4L-SKU",
  "YOKOHAMA MTZ5LA": "YOKO-MTZ5LA-SKU"
}
```

## Running the Seeder

```bash
# Dry run preview (no database modifications):
npm run seed:historical -- --dry-run

# Run sample verification test (verifies DB insertion & invoice PDF rendering):
npm run seed:historical -- --sample

# Execute production import of validated records:
npm run seed:historical -- --import --confirm
```
