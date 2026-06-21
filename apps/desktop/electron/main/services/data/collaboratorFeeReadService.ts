import type { DatabaseSync } from "node:sqlite";

import {
  LOCAL_FALLBACK_WORKSPACE_ID,
  type CollaboratorFeeDetail,
  type CollaboratorFeeListQuery,
  type CollaboratorFeeRow,
  type CollaboratorFeeStatus,
  type CollaboratorFeeSuggestion,
  type CollaboratorFeeSummary,
} from "@contracts";

const defaultQuery: CollaboratorFeeListQuery = {
  search: "",
  sortBy: "expectedDate",
  sortDirection: "desc",
  status: "all",
};

const normalizeSearch = (value?: string) => value?.trim().toLowerCase() ?? "";
const resolveWorkspaceId = (workspaceId?: string | null) => workspaceId?.trim() || LOCAL_FALLBACK_WORKSPACE_ID;

const mapFeeRow = (row: Record<string, unknown>): CollaboratorFeeRow => ({
  id: String(row.id),
  workspaceId: String(row.workspace_id),
  crewMemberId: String(row.crew_member_id),
  crewMemberName: String(row.crew_member_name ?? "Crew member"),
  projectId: row.project_id ? String(row.project_id) : null,
  projectName: row.project_name ? String(row.project_name) : null,
  projectUnitId: row.project_unit_id ? String(row.project_unit_id) : null,
  projectUnitName: row.project_unit_name ? String(row.project_unit_name) : null,
  departmentId: row.department_id ? String(row.department_id) : null,
  departmentName: row.department_name ? String(row.department_name) : null,
  sourceAssignmentId: row.source_assignment_id ? String(row.source_assignment_id) : null,
  feeType: String(row.fee_type),
  description: row.description ? String(row.description) : null,
  agreedAmount: Number(row.agreed_amount),
  paidAmount: Number(row.paid_amount),
  outstandingAmount: Number(row.outstanding_amount),
  currency: String(row.currency),
  exchangeRate: row.exchange_rate === null || row.exchange_rate === undefined ? null : Number(row.exchange_rate),
  baseCurrencyAmount:
    row.base_currency_amount === null || row.base_currency_amount === undefined
      ? null
      : Number(row.base_currency_amount),
  status: String(row.status) as CollaboratorFeeStatus,
  expectedPaymentDate: row.expected_payment_date ? String(row.expected_payment_date) : null,
  notes: row.notes ? String(row.notes) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export const createCollaboratorFeeReadService = (db: DatabaseSync) => {
  const baseFeeSql = `
    SELECT
      collaborator_fees.*,
      crew_members.full_name AS crew_member_name,
      projects.name AS project_name,
      project_units.name AS project_unit_name,
      departments.name AS department_name
    FROM collaborator_fees
    JOIN crew_members ON crew_members.id = collaborator_fees.crew_member_id
    LEFT JOIN projects ON projects.id = collaborator_fees.project_id
    LEFT JOIN project_units ON project_units.id = collaborator_fees.project_unit_id
    LEFT JOIN departments ON departments.id = collaborator_fees.department_id
  `;

  const listFees = (query: CollaboratorFeeListQuery = defaultQuery): CollaboratorFeeRow[] => {
    const workspaceId = resolveWorkspaceId(query.workspaceId);
    const params: unknown[] = [workspaceId];
    const clauses = ["collaborator_fees.workspace_id = ?"];

    if (query.status && query.status !== "all") {
      clauses.push("collaborator_fees.status = ?");
      params.push(query.status);
    }
    if (query.projectId) {
      clauses.push("collaborator_fees.project_id = ?");
      params.push(query.projectId);
    }
    if (query.crewMemberId) {
      clauses.push("collaborator_fees.crew_member_id = ?");
      params.push(query.crewMemberId);
    }

    const rows = db
      .prepare(`${baseFeeSql} WHERE ${clauses.join(" AND ")}`)
      .all(...(params as any[])) as Record<string, unknown>[];
    const search = normalizeSearch(query.search);
    const filtered = search
      ? rows.filter((row) =>
          [
            row.crew_member_name,
            row.project_name,
            row.project_unit_name,
            row.department_name,
            row.fee_type,
            row.description,
            row.status,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search)),
        )
      : rows;

    const sortBy = query.sortBy ?? defaultQuery.sortBy;
    const direction = query.sortDirection === "asc" ? 1 : -1;
    const valueFor = (row: Record<string, unknown>) => {
      if (sortBy === "crew") return String(row.crew_member_name ?? "");
      if (sortBy === "project") return String(row.project_name ?? "");
      if (sortBy === "feeType") return String(row.fee_type ?? "");
      if (sortBy === "amount") return Number(row.agreed_amount ?? 0);
      if (sortBy === "outstanding") return Number(row.outstanding_amount ?? 0);
      if (sortBy === "status") return String(row.status ?? "");
      return String(row.expected_payment_date ?? row.created_at ?? "");
    };

    return filtered
      .sort((left, right) => {
        const leftValue = valueFor(left);
        const rightValue = valueFor(right);
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          return (leftValue - rightValue) * direction;
        }
        return String(leftValue).localeCompare(String(rightValue)) * direction;
      })
      .map(mapFeeRow);
  };

  return {
    listFees,

    getFeeDetail(workspaceId: string, feeId: string): CollaboratorFeeDetail | null {
      const row = db
        .prepare(`${baseFeeSql} WHERE collaborator_fees.workspace_id = ? AND collaborator_fees.id = ? LIMIT 1`)
        .get(workspaceId, feeId) as Record<string, unknown> | undefined;
      if (!row) return null;

      const payments = db
        .prepare(
          `
            SELECT
              collaborator_fee_payments.id,
              collaborator_fee_payments.payment_batch_id,
              collaborator_fee_payments.fee_id,
              collaborator_payment_batches.paid_at,
              collaborator_fee_payments.amount,
              collaborator_fee_payments.currency,
              collaborator_payment_batches.payment_method,
              collaborator_payment_batches.reference,
              collaborator_payment_batches.notes,
              collaborator_fee_payments.created_at
            FROM collaborator_fee_payments
            JOIN collaborator_payment_batches
              ON collaborator_payment_batches.id = collaborator_fee_payments.payment_batch_id
            WHERE collaborator_fee_payments.workspace_id = ?
              AND collaborator_fee_payments.fee_id = ?
            ORDER BY collaborator_payment_batches.paid_at DESC, collaborator_fee_payments.created_at DESC
          `,
        )
        .all(workspaceId, feeId) as Array<{
        id: string;
        payment_batch_id: string;
        fee_id: string;
        paid_at: string;
        amount: number;
        currency: string;
        payment_method: string | null;
        reference: string | null;
        notes: string | null;
        created_at: string;
      }>;

      return {
        ...mapFeeRow(row),
        payments: payments.map((payment) => ({
          id: payment.id,
          paymentBatchId: payment.payment_batch_id,
          feeId: payment.fee_id,
          paidAt: payment.paid_at,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.payment_method,
          reference: payment.reference,
          notes: payment.notes,
          createdAt: payment.created_at,
        })),
      };
    },

    getSummary(input: { workspaceId: string; projectId?: string | null }): CollaboratorFeeSummary {
      const rows = listFees({
        ...defaultQuery,
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
      });
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const paidThisMonth = (db
        .prepare(
          `
            SELECT COALESCE(SUM(collaborator_fee_payments.amount), 0) AS amount
            FROM collaborator_fee_payments
            JOIN collaborator_payment_batches
              ON collaborator_payment_batches.id = collaborator_fee_payments.payment_batch_id
            JOIN collaborator_fees
              ON collaborator_fees.id = collaborator_fee_payments.fee_id
            WHERE collaborator_fee_payments.workspace_id = ?
              AND collaborator_payment_batches.paid_at >= ?
              AND collaborator_payment_batches.paid_at <= ?
              AND (? IS NULL OR collaborator_fees.project_id = ?)
          `,
        )
        .get(input.workspaceId, monthStart, monthEnd, input.projectId ?? null, input.projectId ?? null) as { amount: number }).amount;

      const byCollaborator = new Map<string, CollaboratorFeeSummary["byCollaborator"][number]>();
      const byProject = new Map<string, CollaboratorFeeSummary["byProject"][number]>();
      rows.forEach((row) => {
        const collaborator = byCollaborator.get(row.crewMemberId) ?? {
          crewMemberId: row.crewMemberId,
          crewMemberName: row.crewMemberName,
          pendingAmount: 0,
          paidAmount: 0,
          currency: row.currency,
        };
        collaborator.pendingAmount += row.outstandingAmount;
        collaborator.paidAmount += row.paidAmount;
        byCollaborator.set(row.crewMemberId, collaborator);

        const projectKey = row.projectId ?? "unassigned";
        const project = byProject.get(projectKey) ?? {
          projectId: row.projectId,
          projectName: row.projectName ?? "Unassigned",
          pendingAmount: 0,
          paidAmount: 0,
          currency: row.currency,
        };
        project.pendingAmount += row.outstandingAmount;
        project.paidAmount += row.paidAmount;
        byProject.set(projectKey, project);
      });

      return {
        pendingAmount: rows.reduce((sum, row) => sum + row.outstandingAmount, 0),
        approvedAmount: rows
          .filter((row) => row.status === "approved" || row.status === "scheduled" || row.status === "partially_paid")
          .reduce((sum, row) => sum + row.outstandingAmount, 0),
        paidThisMonth,
        collaboratorsWithBalance: [...byCollaborator.values()].filter((row) => row.pendingAmount > 0).length,
        byCollaborator: [...byCollaborator.values()].sort((a, b) => b.pendingAmount - a.pendingAmount),
        byProject: [...byProject.values()].sort((a, b) => b.pendingAmount - a.pendingAmount),
      };
    },

    suggestFromAssignments(input: {
      workspaceId: string;
      projectId?: string | null;
      crewMemberId?: string | null;
    }): CollaboratorFeeSuggestion[] {
      const params: unknown[] = [input.workspaceId, input.workspaceId];
      const clauses = [
        "project_unit_crew_assignments.workspace_id = ?",
        `NOT EXISTS (
          SELECT 1
          FROM collaborator_fees
          WHERE collaborator_fees.workspace_id = ?
            AND collaborator_fees.source_assignment_id = project_unit_crew_assignments.id
            AND collaborator_fees.status <> 'cancelled'
        )`,
      ];
      if (input.projectId) {
        clauses.push("project_units.project_id = ?");
        params.push(input.projectId);
      }
      if (input.crewMemberId) {
        clauses.push("project_unit_crew_assignments.crew_member_id = ?");
        params.push(input.crewMemberId);
      }

      const rows = db
        .prepare(
          `
            SELECT
              project_unit_crew_assignments.id AS assignment_id,
              project_unit_crew_assignments.crew_member_id,
              crew_members.full_name AS crew_member_name,
              project_units.project_id,
              projects.name AS project_name,
              project_units.id AS project_unit_id,
              project_units.name AS project_unit_name,
              NULL AS department_id,
              NULL AS department_name,
              project_unit_crew_assignments.role_label,
              COALESCE(project_unit_crew_assignments.start_date, project_units.start_date, projects.start_date) AS start_date,
              COALESCE(project_unit_crew_assignments.end_date, project_units.end_date, projects.end_date) AS end_date
            FROM project_unit_crew_assignments
            JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            JOIN projects ON projects.id = project_units.project_id
            WHERE ${clauses.join(" AND ")}
            ORDER BY projects.name, project_units.sort_order, crew_members.full_name
          `,
        )
        .all(...(params as any[])) as Array<{
        assignment_id: string;
        crew_member_id: string;
        crew_member_name: string;
        project_id: string;
        project_name: string;
        project_unit_id: string;
        project_unit_name: string;
        department_id: string | null;
        department_name: string | null;
        role_label: string | null;
        start_date: string | null;
        end_date: string | null;
      }>;

      return rows.map((row) => ({
        suggestionId: `suggestion-${row.assignment_id}`,
        crewMemberId: row.crew_member_id,
        crewMemberName: row.crew_member_name,
        projectId: row.project_id,
        projectName: row.project_name,
        projectUnitId: row.project_unit_id,
        projectUnitName: row.project_unit_name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        sourceAssignmentId: row.assignment_id,
        roleLabel: row.role_label,
        startDate: row.start_date,
        endDate: row.end_date,
        feeType: row.role_label ?? "Crew fee",
        description: `${row.crew_member_name} · ${row.project_name} · ${row.project_unit_name}`,
        currency: "DOP",
      }));
    },
  };
};

export type CollaboratorFeeReadService = ReturnType<typeof createCollaboratorFeeReadService>;
