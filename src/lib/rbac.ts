import type { UserRole } from "@/generated/prisma/enums";

/**
 * Permission catalogue. Every server action and route handler authorises against
 * one of these codes — never against a role directly — so that per-user grants
 * and revocations can override the role defaults. Codes follow the handover
 * spec: products.view, inventory.adjust, invoice.create, gst_reports.view, ...
 */
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: "dashboard.view",
  DASHBOARD_FINANCIALS: "dashboard.financials",
  DASHBOARD_VIEW_ALL_BRANCHES: "dashboard.view_all_branches",

  // Products & catalogue
  PRODUCT_VIEW: "products.view",
  PRODUCT_CREATE: "products.create",
  PRODUCT_EDIT: "products.edit",
  PRODUCT_DELETE: "products.delete",
  PRODUCT_IMPORT: "products.import",
  CATEGORY_MANAGE: "category.manage",

  // Inventory
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_ADJUST: "inventory.adjust",
  INVENTORY_TRANSFER: "inventory.transfer",
  SERIALS_VIEW: "serials.view",
  SERIALS_MANAGE: "serials.manage",

  // Sales
  SALES_VIEW: "sales.view",
  SALES_CREATE: "sales.create",
  SALES_EDIT: "sales.edit",
  SALES_CANCEL: "sales.cancel",
  QUOTATION_VIEW: "quotation.view",
  QUOTATION_CREATE: "quotation.create",
  QUOTATION_EDIT: "quotation.edit",
  QUOTATION_DELETE: "quotation.delete",
  QUOTATION_CONVERT: "quotation.convert",
  SALES_RETURN_CREATE: "sales_return.create",

  // Invoices
  INVOICE_VIEW: "invoice.view",
  INVOICE_CREATE: "invoice.create",
  INVOICE_EDIT: "invoice.edit",
  INVOICE_CANCEL: "invoice.cancel",
  INVOICE_DELETE: "invoice.delete",

  // Purchases
  PURCHASE_VIEW: "purchase.view",
  PURCHASE_CREATE: "purchase.create",
  PURCHASE_RECEIVE: "purchase.receive",
  PURCHASE_RETURN_CREATE: "purchase_return.create",

  // Partners
  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_CREATE: "customers.create",
  CUSTOMERS_EDIT: "customers.edit",
  SUPPLIERS_VIEW: "suppliers.view",
  SUPPLIERS_MANAGE: "suppliers.manage",

  // Payments & expenses
  PAYMENTS_VIEW: "payments.view",
  PAYMENTS_CREATE: "payments.create",
  EXPENSES_VIEW: "expenses.view",
  EXPENSES_CREATE: "expenses.create",
  EXPENSES_APPROVE: "expenses.approve",

  // Warranty
  WARRANTY_VIEW: "warranty.view",
  WARRANTY_CLAIM: "warranty.claim",

  // Reports
  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",
  GST_REPORTS_VIEW: "gst_reports.view",

  // Administration
  USERS_VIEW: "users.view",
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  FIRMS_VIEW: "firms.view",
  FIRMS_MANAGE: "firms.manage",
  ACCESS_CODES_MANAGE: "access_codes.manage",
  SETTINGS_MANAGE: "settings.manage",
  AUDIT_VIEW: "audit.view",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];

const P = PERMISSIONS;

/** Super Admin — full system access, cross-firm. */
const PLATFORM_ADMIN_PERMISSIONS: PermissionCode[] = [...ALL_PERMISSIONS, "platform.view" as PermissionCode];

/** Admin — full management of one firm. */
const ADMIN_PERMISSIONS: PermissionCode[] = ALL_PERMISSIONS.filter(
  (code) => code !== P.FIRMS_MANAGE,
);

/** Manager — business operations across the firm. */
const MANAGER_PERMISSIONS: PermissionCode[] = [
  P.DASHBOARD_VIEW,
  P.DASHBOARD_FINANCIALS,
  P.DASHBOARD_VIEW_ALL_BRANCHES,
  P.PRODUCT_VIEW,
  P.PRODUCT_CREATE,
  P.PRODUCT_EDIT,
  P.CATEGORY_MANAGE,
  P.INVENTORY_VIEW,
  P.INVENTORY_ADJUST,
  P.INVENTORY_TRANSFER,
  P.SERIALS_VIEW,
  P.SERIALS_MANAGE,
  P.SALES_VIEW,
  P.SALES_CREATE,
  P.SALES_EDIT,
  P.SALES_CANCEL,
  P.QUOTATION_VIEW,
  P.QUOTATION_CREATE,
  P.QUOTATION_EDIT,
  P.QUOTATION_DELETE,
  P.QUOTATION_CONVERT,
  P.SALES_RETURN_CREATE,
  P.INVOICE_VIEW,
  P.INVOICE_CREATE,
  P.INVOICE_EDIT,
  P.INVOICE_CANCEL,
  P.INVOICE_DELETE,
  P.PURCHASE_VIEW,
  P.PURCHASE_CREATE,
  P.PURCHASE_RECEIVE,
  P.PURCHASE_RETURN_CREATE,
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_CREATE,
  P.CUSTOMERS_EDIT,
  P.SUPPLIERS_VIEW,
  P.SUPPLIERS_MANAGE,
  P.PAYMENTS_VIEW,
  P.PAYMENTS_CREATE,
  P.EXPENSES_VIEW,
  P.EXPENSES_CREATE,
  P.EXPENSES_APPROVE,
  P.WARRANTY_VIEW,
  P.WARRANTY_CLAIM,
  P.REPORTS_VIEW,
  P.REPORTS_EXPORT,
  P.GST_REPORTS_VIEW,
  P.USERS_VIEW,
  P.AUDIT_VIEW,
  P.SETTINGS_MANAGE,
];

/** Accountant — invoices, payments, expenses, accounts and reports. */
const ACCOUNTANT_PERMISSIONS: PermissionCode[] = [
  P.DASHBOARD_VIEW,
  P.DASHBOARD_FINANCIALS,
  P.PRODUCT_VIEW,
  P.INVENTORY_VIEW,
  P.SALES_VIEW,
  P.INVOICE_VIEW,
  P.INVOICE_CREATE,
  P.INVOICE_EDIT,
  P.INVOICE_CANCEL,
  P.INVOICE_DELETE,
  P.PURCHASE_VIEW,
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_CREATE,
  P.CUSTOMERS_EDIT,
  P.SUPPLIERS_VIEW,
  P.PAYMENTS_VIEW,
  P.PAYMENTS_CREATE,
  P.EXPENSES_VIEW,
  P.EXPENSES_CREATE,
  P.EXPENSES_APPROVE,
  P.WARRANTY_VIEW,
  P.REPORTS_VIEW,
  P.REPORTS_EXPORT,
  P.GST_REPORTS_VIEW,
  P.AUDIT_VIEW,
];

/** Sales Staff — customers, quotations, sales and invoices. */
const SALES_STAFF_PERMISSIONS: PermissionCode[] = [
  P.DASHBOARD_VIEW,
  P.PRODUCT_VIEW,
  P.INVENTORY_VIEW,
  P.SERIALS_VIEW,
  P.SALES_VIEW,
  P.SALES_CREATE,
  P.SALES_EDIT,
  P.QUOTATION_VIEW,
  P.QUOTATION_CREATE,
  P.QUOTATION_EDIT,
  P.QUOTATION_DELETE,
  P.QUOTATION_CONVERT,
  P.SALES_RETURN_CREATE,
  P.INVOICE_VIEW,
  P.INVOICE_CREATE,
  P.INVOICE_EDIT,
  P.INVOICE_DELETE,
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_CREATE,
  P.CUSTOMERS_EDIT,
  P.PAYMENTS_VIEW,
  P.PAYMENTS_CREATE,
  P.WARRANTY_VIEW,
];

/** Purchase Staff — suppliers, purchase orders and purchases. */
const PURCHASE_STAFF_PERMISSIONS: PermissionCode[] = [
  P.DASHBOARD_VIEW,
  P.PRODUCT_VIEW,
  P.INVENTORY_VIEW,
  P.SERIALS_VIEW,
  P.PURCHASE_VIEW,
  P.PURCHASE_CREATE,
  P.PURCHASE_RECEIVE,
  P.PURCHASE_RETURN_CREATE,
  P.SUPPLIERS_VIEW,
  P.SUPPLIERS_MANAGE,
  P.PAYMENTS_VIEW,
];

/** Inventory Manager — products and inventory. */
const INVENTORY_MANAGER_PERMISSIONS: PermissionCode[] = [
  P.DASHBOARD_VIEW,
  P.PRODUCT_VIEW,
  P.PRODUCT_CREATE,
  P.PRODUCT_EDIT,
  P.PRODUCT_IMPORT,
  P.CATEGORY_MANAGE,
  P.INVENTORY_VIEW,
  P.INVENTORY_ADJUST,
  P.INVENTORY_TRANSFER,
  P.SERIALS_VIEW,
  P.SERIALS_MANAGE,
  P.WARRANTY_VIEW,
  P.SALES_VIEW,
  P.PURCHASE_VIEW,
  P.PURCHASE_RECEIVE,
  P.REPORTS_VIEW,
];

/** Viewer — read-only access. */
const VIEWER_PERMISSIONS: PermissionCode[] = [
  P.DASHBOARD_VIEW,
  P.PRODUCT_VIEW,
  P.INVENTORY_VIEW,
  P.SERIALS_VIEW,
  P.SALES_VIEW,
  P.QUOTATION_VIEW,
  P.INVOICE_VIEW,
  P.PURCHASE_VIEW,
  P.CUSTOMERS_VIEW,
  P.SUPPLIERS_VIEW,
  P.PAYMENTS_VIEW,
  P.EXPENSES_VIEW,
  P.WARRANTY_VIEW,
  P.REPORTS_VIEW,
];

/**
 * Default role → permission matrix. Seeded into the database as RolePermission
 * rows; per-user overrides live in UserPermission.
 */
export const ROLE_PERMISSIONS: Record<UserRole, PermissionCode[]> = {
  PLATFORM_ADMIN: [...new Set(PLATFORM_ADMIN_PERMISSIONS)],
  ADMIN: [...new Set(ADMIN_PERMISSIONS)],
  MANAGER: [...new Set(MANAGER_PERMISSIONS)],
  ACCOUNTANT: [...new Set(ACCOUNTANT_PERMISSIONS)],
  SALES_STAFF: [...new Set(SALES_STAFF_PERMISSIONS)],
  PURCHASE_STAFF: [...new Set(PURCHASE_STAFF_PERMISSIONS)],
  INVENTORY_MANAGER: [...new Set(INVENTORY_MANAGER_PERMISSIONS)],
  VIEWER: [...new Set(VIEWER_PERMISSIONS)],
};

/** Roles that may see data across every branch (still bounded to their own firm). */
export const GLOBAL_ROLES: UserRole[] = ["PLATFORM_ADMIN", "ADMIN"];

export function isGlobalRole(role: UserRole): boolean {
  return GLOBAL_ROLES.includes(role);
}

/** True cross-firm role — the only one that can operate without a firm selected. */
export function isPlatformRole(role: UserRole): boolean {
  return role === "PLATFORM_ADMIN";
}

export function defaultPermissionsFor(role: UserRole): PermissionCode[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  PLATFORM_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  ACCOUNTANT: "Accountant",
  SALES_STAFF: "Sales Staff",
  PURCHASE_STAFF: "Purchase Staff",
  INVENTORY_MANAGER: "Inventory Manager",
  VIEWER: "Viewer",
};

/** Where a user of this role should land right after login. */
export const ROLE_LANDING_PATH: Record<UserRole, string> = {
  PLATFORM_ADMIN: "/firms",
  ADMIN: "/dashboard",
  MANAGER: "/dashboard",
  ACCOUNTANT: "/dashboard",
  SALES_STAFF: "/pos",
  PURCHASE_STAFF: "/purchases",
  INVENTORY_MANAGER: "/inventory",
  VIEWER: "/dashboard",
};

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [P.DASHBOARD_VIEW]: "View the dashboard",
  [P.DASHBOARD_FINANCIALS]: "See revenue, outstanding and profit figures",
  [P.DASHBOARD_VIEW_ALL_BRANCHES]: "See data for every branch, not just the assigned one",
  [P.PRODUCT_VIEW]: "View products and the catalogue",
  [P.PRODUCT_CREATE]: "Create products",
  [P.PRODUCT_EDIT]: "Edit products, variants and prices",
  [P.PRODUCT_DELETE]: "Deactivate or delete products",
  [P.PRODUCT_IMPORT]: "Bulk import products from CSV/Excel",
  [P.CATEGORY_MANAGE]: "Manage categories and brands",
  [P.INVENTORY_VIEW]: "View stock levels and transactions",
  [P.INVENTORY_ADJUST]: "Perform stock adjustments",
  [P.INVENTORY_TRANSFER]: "Transfer stock between branches",
  [P.SERIALS_VIEW]: "View serial numbers and IMEIs",
  [P.SERIALS_MANAGE]: "Manage serial units and their status",
  [P.SALES_VIEW]: "View sales orders and quotations",
  [P.SALES_CREATE]: "Create sales orders",
  [P.SALES_EDIT]: "Edit sales orders",
  [P.SALES_CANCEL]: "Cancel sales orders",
  [P.QUOTATION_VIEW]: "View quotations",
  [P.QUOTATION_CREATE]: "Create quotations",
  [P.QUOTATION_EDIT]: "Edit quotations",
  [P.QUOTATION_DELETE]: "Delete quotations",
  [P.QUOTATION_CONVERT]: "Convert quotations to invoices",
  [P.SALES_RETURN_CREATE]: "Create sales returns",
  [P.INVOICE_VIEW]: "View invoices",
  [P.INVOICE_CREATE]: "Create invoices",
  [P.INVOICE_EDIT]: "Edit invoices",
  [P.INVOICE_CANCEL]: "Cancel invoices",
  [P.INVOICE_DELETE]: "Delete invoices",
  [P.PURCHASE_VIEW]: "View purchase orders and supplier bills",
  [P.PURCHASE_CREATE]: "Create purchase orders",
  [P.PURCHASE_RECEIVE]: "Receive goods and create purchase invoices",
  [P.PURCHASE_RETURN_CREATE]: "Create purchase returns",
  [P.CUSTOMERS_VIEW]: "View customers",
  [P.CUSTOMERS_CREATE]: "Create customers",
  [P.CUSTOMERS_EDIT]: "Edit customers",
  [P.SUPPLIERS_VIEW]: "View suppliers",
  [P.SUPPLIERS_MANAGE]: "Create and edit suppliers",
  [P.PAYMENTS_VIEW]: "View payments and outstanding balances",
  [P.PAYMENTS_CREATE]: "Record payments",
  [P.EXPENSES_VIEW]: "View expenses",
  [P.EXPENSES_CREATE]: "Record expenses",
  [P.EXPENSES_APPROVE]: "Approve expenses",
  [P.WARRANTY_VIEW]: "View warranties and lookup",
  [P.WARRANTY_CLAIM]: "Register warranty claims",
  [P.REPORTS_VIEW]: "Open the reports module",
  [P.REPORTS_EXPORT]: "Export reports and data as CSV",
  [P.GST_REPORTS_VIEW]: "View GST reports",
  [P.USERS_VIEW]: "View user accounts",
  [P.USERS_MANAGE]: "Create and manage users",
  [P.ROLES_MANAGE]: "Change role permissions and user overrides",
  [P.FIRMS_VIEW]: "View firms",
  [P.FIRMS_MANAGE]: "Create, edit and deactivate firms",
  [P.ACCESS_CODES_MANAGE]: "Manage GST / non-GST access codes",
  [P.SETTINGS_MANAGE]: "Change firm settings and document numbering",
  [P.AUDIT_VIEW]: "View the audit log",
  "platform.view": "View platform-wide statistics across all firms",
};
