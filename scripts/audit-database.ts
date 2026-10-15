// Bypass server-only guard for standalone script
import Module from "node:module";
// @ts-ignore
const originalRequire = Module.prototype.require;
// @ts-ignore
Module.prototype.require = function (id) {
  if (id === "server-only") return {};
  // @ts-ignore
  return originalRequire.apply(this, arguments);
};

async function audit() {
  const { prisma } = await import("../src/lib/prisma");

  console.log("=== COMPREHENSIVE ERP DATABASE AUDIT ===\n");

  const tables = [
    { name: "firms", count: await prisma.firm.count(), data: await prisma.firm.findMany({ select: { id: true, name: true, code: true, status: true } }) },
    { name: "branches", count: await prisma.branch.count(), data: await prisma.branch.findMany({ select: { id: true, name: true, code: true, type: true } }) },
    { name: "users", count: await prisma.user.count(), data: await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, accessCode: true } }) },
    { name: "permissions", count: await prisma.permission.count() },
    { name: "role_permissions", count: await prisma.rolePermission.count() },
    { name: "user_permissions", count: await prisma.userPermission.count() },
    { name: "access_codes", count: await prisma.accessCode.count() },
    { name: "settings", count: await prisma.setting.count(), data: await prisma.setting.findMany() },
    { name: "document_sequences", count: await prisma.documentSequence.count() },
    { name: "categories", count: await prisma.category.count() },
    { name: "brands", count: await prisma.brand.count() },
    { name: "products", count: await prisma.product.count() },
    { name: "product_variants", count: await prisma.productVariant.count() },
    { name: "product_attributes", count: await prisma.productAttribute.count() },
    { name: "serial_units", count: await prisma.serialUnit.count() },
    { name: "serial_history", count: await prisma.serialHistory.count() },
    { name: "stock_transactions", count: await prisma.stockTransaction.count() },
    { name: "stock_adjustments", count: await prisma.stockAdjustment.count() },
    { name: "stock_transfers", count: await prisma.stockTransfer.count() },
    { name: "stock_transfer_lines", count: await prisma.stockTransferLine.count() },
    { name: "customers", count: await prisma.customer.count() },
    { name: "suppliers", count: await prisma.supplier.count() },
    { name: "quotations", count: await prisma.quotation.count() },
    { name: "quotation_lines", count: await prisma.quotationLine.count() },
    { name: "sales_orders", count: await prisma.salesOrder.count() },
    { name: "sales_order_lines", count: await prisma.salesOrderLine.count() },
    { name: "invoices", count: await prisma.invoice.count() },
    { name: "invoice_lines", count: await prisma.invoiceLine.count() },
    { name: "sales_returns", count: await prisma.salesReturn.count() },
    { name: "sales_return_lines", count: await prisma.salesReturnLine.count() },
    { name: "purchase_orders", count: await prisma.purchaseOrder.count() },
    { name: "purchase_order_lines", count: await prisma.purchaseOrderLine.count() },
    { name: "goods_receipts", count: await prisma.goodsReceipt.count() },
    { name: "goods_receipt_lines", count: await prisma.goodsReceiptLine.count() },
    { name: "purchase_invoices", count: await prisma.purchaseInvoice.count() },
    { name: "purchase_invoice_lines", count: await prisma.purchaseInvoiceLine.count() },
    { name: "purchase_returns", count: await prisma.purchaseReturn.count() },
    { name: "purchase_return_lines", count: await prisma.purchaseReturnLine.count() },
    { name: "payments", count: await prisma.payment.count() },
    { name: "supplier_payments", count: await prisma.supplierPayment.count() },
    { name: "expenses", count: await prisma.expense.count() },
    { name: "warranties", count: await prisma.warranty.count() },
    { name: "journal_entries", count: await prisma.journalEntry.count() },
    { name: "whatsapp_logs", count: await prisma.whatsAppLog.count() },
    { name: "whatsapp_templates", count: await prisma.whatsAppTemplate.count() },
    { name: "audit_logs", count: await prisma.auditLog.count() },
  ];

  console.log("Table Row Counts:");
  console.log("-----------------------------------------");
  let totalBusinessRecords = 0;
  for (const t of tables) {
    const isSystemOrAuth = ["firms", "branches", "users", "permissions", "role_permissions", "user_permissions", "access_codes", "settings"].includes(t.name);
    console.log(`${t.name.padEnd(25)} : ${t.count} rows ${isSystemOrAuth ? "(System/Auth)" : ""}`);
    if (!isSystemOrAuth) {
      totalBusinessRecords += t.count;
    }
    if (t.data && t.data.length > 0) {
      console.log(`  Preview:`, JSON.stringify(t.data, null, 2));
    }
  }
  console.log("-----------------------------------------");
  console.log(`Total Business Records: ${totalBusinessRecords}`);

  if (totalBusinessRecords > 0) {
    console.log("\nFound remaining business records. Cleaning them up now...");
    await prisma.serialHistory.deleteMany();
    await prisma.serialUnit.deleteMany();
    await prisma.warranty.deleteMany();
    await prisma.stockTransaction.deleteMany();
    await prisma.stockAdjustment.deleteMany();
    await prisma.stockTransferLine.deleteMany();
    await prisma.stockTransfer.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.supplierPayment.deleteMany();
    await prisma.salesReturnLine.deleteMany();
    await prisma.salesReturn.deleteMany();
    await prisma.invoiceLine.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.salesOrderLine.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.quotationLine.deleteMany();
    await prisma.quotation.deleteMany();
    await prisma.goodsReceiptLine.deleteMany();
    await prisma.goodsReceipt.deleteMany();
    await prisma.purchaseInvoiceLine.deleteMany();
    await prisma.purchaseInvoice.deleteMany();
    await prisma.purchaseReturnLine.deleteMany();
    await prisma.purchaseReturn.deleteMany();
    await prisma.purchaseOrderLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.journalEntry.deleteMany();
    await prisma.whatsAppLog.deleteMany();
    await prisma.productAttribute.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.brand.deleteMany();
    await prisma.category.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.documentSequence.deleteMany();
    await prisma.auditLog.deleteMany();
    console.log("✓ All business records cleared.");
  } else {
    console.log("\n✓ Database contains 0 dummy business records! Perfectly clean.");
  }
}

audit().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
