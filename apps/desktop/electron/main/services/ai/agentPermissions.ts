// Shared permission vocabulary for the agent layer. Centralizes the typed
// error thrown when a tool is blocked by role and the human-readable labels we
// surface to the user (the model localizes from these), so in-app and Telegram
// give the same clear, actionable explanation instead of a raw permission key.

/** Thrown whenever an actor lacks the permission a tool requires. */
export class PermissionDeniedError extends Error {
  readonly permission: string;
  readonly toolName: string | null;

  constructor(permission: string, toolName: string | null = null) {
    super(`Blocked. This action requires the ${permission} permission.`);
    this.name = "PermissionDeniedError";
    this.permission = permission;
    this.toolName = toolName;
  }
}

// Plain-language label for each gated permission (Spanish-primary workspace; the
// model adapts to the user's language). Falls back to the raw key if unmapped.
const PERMISSION_LABELS: Record<string, string> = {
  "projects.read": "ver proyectos",
  "projects.manage": "gestionar proyectos",
  "assets.read": "ver equipos",
  "assets.manage": "gestionar equipos",
  "incidents.read": "ver incidentes",
  "incidents.create": "reportar incidentes",
  "rma.read": "ver RMAs",
  "rma.create": "crear RMAs",
  "packing-slips.read": "ver packing slips",
  "packing-slips.create": "crear packing slips",
  "finance.read": "ver finanzas",
  "finance.manage": "gestionar finanzas (cotizaciones y entradas)",
  "currency.manage_rates": "gestionar tipos de cambio",
  "treasury.transactions.read": "ver tesorería",
  "treasury.transactions.classify": "clasificar movimientos de tesorería",
  "treasury.accounts.manage": "gestionar cuentas bancarias",
  "treasury.import": "importar estados de cuenta",
  "treasury.reimbursements.review": "revisar reembolsos",
  "treasury.export": "exportar reportes de tesorería",
  "agents.manage": "administrar agentes",
  "communications.send": "enviar mensajes al equipo",
};

export const describePermission = (permission: string): string => PERMISSION_LABELS[permission] ?? permission;
