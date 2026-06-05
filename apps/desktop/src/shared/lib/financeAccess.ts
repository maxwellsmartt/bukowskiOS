type MembershipPermissions = {
  roleKey: string | null;
  permissions: string[];
};

export const financeAccessPermissionKeys = [
  "finance.read",
  "finance.manage",
  "currency.manage_rates",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "quotes.cancel",
  "quotes.export",
  "quotes.manage_templates",
  "invoices.read",
  "invoices.create",
  "invoices.edit_draft",
  "invoices.issue",
  "invoices.cancel",
  "invoices.record_payment",
  "invoices.export",
  "treasury.accounts.manage",
  "treasury.import",
  "treasury.transactions.read",
  "treasury.transactions.classify",
  "treasury.reimbursements.review",
  "treasury.export",
  "crew_fees.read",
  "crew_fees.manage",
  "crew_payments.record",
] as const;

export const treasuryReadPermissionKeys = [
  "treasury.transactions.read",
  "treasury.accounts.manage",
  "treasury.import",
  "treasury.transactions.classify",
  "treasury.reimbursements.review",
  "treasury.export",
] as const;

export const financeBusinessReadPermissionKeys = [
  "finance.read",
  "finance.manage",
  "currency.manage_rates",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "quotes.cancel",
  "quotes.export",
  "invoices.read",
  "invoices.create",
  "invoices.edit_draft",
  "invoices.issue",
  "invoices.cancel",
  "invoices.record_payment",
  "invoices.export",
] as const;

export const collaboratorPaymentReadPermissionKeys = [
  "crew_fees.read",
  "crew_fees.manage",
  "crew_payments.record",
] as const;

const hasAnyPermission = (permissions: readonly string[], permissionKeys: readonly string[]) =>
  permissions.includes("*") || permissionKeys.some((permissionKey) => permissions.includes(permissionKey));

export const hasFinanceAccess = (membership: MembershipPermissions | null | undefined) =>
  Boolean(
    membership?.roleKey === "admin" ||
      (membership?.permissions ? hasAnyPermission(membership.permissions, financeAccessPermissionKeys) : false),
  );

export const canReadTreasury = (membership: MembershipPermissions | null | undefined) =>
  Boolean(
    membership?.roleKey === "admin" ||
      (membership?.permissions ? hasAnyPermission(membership.permissions, treasuryReadPermissionKeys) : false),
  );

export const canReadFinanceBusiness = (membership: MembershipPermissions | null | undefined) =>
  Boolean(
    membership?.roleKey === "admin" ||
      (membership?.permissions ? hasAnyPermission(membership.permissions, financeBusinessReadPermissionKeys) : false),
  );

export const canReadCollaboratorPayments = (membership: MembershipPermissions | null | undefined) =>
  Boolean(
    membership?.roleKey === "admin" ||
      (membership?.permissions ? hasAnyPermission(membership.permissions, collaboratorPaymentReadPermissionKeys) : false),
  );
