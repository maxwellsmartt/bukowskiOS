import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectBudgetTarget = {
  amount: number;
  currency: string;
  notes: string | null;
  updatedAt: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (client: SupabaseClient): any => client as unknown;

export const fetchProjectBudgetTarget = async (
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectBudgetTarget | null> => {
  const { data, error } = await loose(supabase)
    .from("project_budget_targets")
    .select("amount,currency,notes,updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    amount: Number((data as { amount: number | string }).amount) || 0,
    currency: (data as { currency: string }).currency ?? "USD",
    notes: ((data as { notes: string | null }).notes ?? null) || null,
    updatedAt: (data as { updated_at: string | null }).updated_at ?? null,
  };
};

export const upsertProjectBudgetTarget = async (
  supabase: SupabaseClient,
  input: { projectId: string; workspaceId: string; amount: number; currency: string; notes?: string | null },
): Promise<void> => {
  const payload = {
    project_id: input.projectId,
    workspace_id: input.workspaceId,
    amount: input.amount,
    currency: input.currency,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await loose(supabase)
    .from("project_budget_targets")
    .upsert(payload, { onConflict: "project_id" });

  if (error) {
    throw new Error(error.message);
  }
};

export const deleteProjectBudgetTarget = async (
  supabase: SupabaseClient,
  projectId: string,
): Promise<void> => {
  const { error } = await loose(supabase)
    .from("project_budget_targets")
    .delete()
    .eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }
};
