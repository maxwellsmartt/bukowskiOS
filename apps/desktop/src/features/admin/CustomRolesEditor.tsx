import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";

import { useToast } from "@app/providers/ToastProvider";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import {
  createCustomRole,
  deleteCustomRole,
  grantPermission,
  loadAllPermissions,
  loadRolesWithPermissions,
  revokePermission,
  updateCustomRole,
  type PermissionDefinition,
  type RolePermissionRow,
} from "./customRolesService";

type CustomRolesEditorProps = {
  supabase: SupabaseClient;
  workspaceId: string;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

const groupForKey = (key: string) => {
  if (key.startsWith("projects.")) return "Projects";
  if (key.startsWith("assets.")) return "Assets";
  if (key.startsWith("licenses.")) return "Assets";
  if (key.startsWith("incidents.")) return "Incidents";
  if (key.startsWith("packing-slips.")) return "Packing";
  if (key.startsWith("finance.")) return "Finance";
  if (key.startsWith("rma.")) return "RMA";
  if (key.startsWith("users.")) return "Team";
  return "Other";
};

export const CustomRolesEditor = ({ supabase, workspaceId }: CustomRolesEditorProps) => {
  const toast = useToast();
  const [roles, setRoles] = useState<RolePermissionRow[]>([]);
  const [allPermissions, setAllPermissions] = useState<PermissionDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCellKey, setPendingCellKey] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: "", description: "" });
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDeleteRole, setPendingDeleteRole] = useState<RolePermissionRow | null>(null);
  const [isDeletingRole, setIsDeletingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<RolePermissionRow | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", description: "" });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nextRoles, nextPermissions] = await Promise.all([
        loadRolesWithPermissions(supabase, workspaceId),
        loadAllPermissions(supabase),
      ]);
      setRoles(nextRoles);
      setAllPermissions(nextPermissions);
      setError(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Could not load roles."));
    } finally {
      setIsLoading(false);
    }
  }, [supabase, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sortedPermissions = useMemo(() => {
    return [...allPermissions].sort((a, b) => {
      const groupA = groupForKey(a.key);
      const groupB = groupForKey(b.key);
      if (groupA !== groupB) {
        return groupA.localeCompare(groupB);
      }
      return a.key.localeCompare(b.key);
    });
  }, [allPermissions]);

  const handleToggle = async (role: RolePermissionRow, permission: PermissionDefinition) => {
    if (role.isSystemRole) {
      toast.info("System role", "System roles can't be edited. Create a custom role to define your own permissions.");
      return;
    }

    const cellKey = `${role.id}:${permission.id}`;
    if (pendingCellKey === cellKey) return;

    const has = role.permissionIds.includes(permission.id);
    setPendingCellKey(cellKey);

    try {
      if (has) {
        await revokePermission(supabase, role.id, permission.id);
      } else {
        await grantPermission(supabase, role.id, permission.id);
      }
      await refresh();
    } catch (nextError) {
      toast.error("Could not save", getUserFacingErrorMessage(nextError, "Permission change rejected."));
    } finally {
      setPendingCellKey(null);
    }
  };

  const handleCreate = async () => {
    const name = createDraft.name.trim();
    if (!name) {
      toast.error("Name required", "Pick a short, descriptive name for the role.");
      return;
    }
    const key = slugify(name);
    if (!key) {
      toast.error("Invalid name", "Use letters, numbers or spaces.");
      return;
    }
    if (roles.some((role) => role.key === key)) {
      toast.error("Already exists", "A role with that key already exists in this workspace.");
      return;
    }

    setIsCreating(true);
    try {
      await createCustomRole(supabase, {
        workspaceId,
        key,
        name,
        description: createDraft.description.trim(),
      });
      toast.success("Role created", `Toggle permissions on the row for "${name}" to grant access.`);
      setCreateDialogOpen(false);
      setCreateDraft({ name: "", description: "" });
      await refresh();
    } catch (nextError) {
      toast.error("Could not create role", getUserFacingErrorMessage(nextError, "Try a different name."));
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingRole) return;
    const name = editDraft.name.trim();
    if (!name) {
      toast.error("Name required", "Pick a short, descriptive name for the role.");
      return;
    }
    if (
      roles.some((role) => role.id !== editingRole.id && role.name.toLowerCase() === name.toLowerCase())
    ) {
      toast.error("Already exists", "Another role in this workspace already uses that name.");
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateCustomRole(supabase, {
        roleId: editingRole.id,
        name,
        description: editDraft.description.trim(),
      });
      toast.success("Role updated", `Renamed to "${name}".`);
      setEditingRole(null);
      await refresh();
    } catch (nextError) {
      toast.error("Could not update role", getUserFacingErrorMessage(nextError, "Try again in a moment."));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteRole) return;
    setIsDeletingRole(true);
    try {
      await deleteCustomRole(supabase, pendingDeleteRole.id);
      toast.success("Role deleted", `${pendingDeleteRole.name} is gone. Members assigned to it lose access.`);
      setPendingDeleteRole(null);
      await refresh();
    } catch (nextError) {
      toast.error(
        "Could not delete role",
        getUserFacingErrorMessage(nextError, "Members might still be assigned to this role."),
      );
    } finally {
      setIsDeletingRole(false);
    }
  };

  let lastGroup = "";

  return (
    <SurfaceCard
      title="Custom roles"
      subtitle="Build roles tailored to your studio. System roles stay locked for safety."
      aside={
        <button
          className="action-primary-button"
          disabled={isLoading}
          onClick={() => setCreateDialogOpen(true)}
          type="button"
        >
          <Plus size={13} />
          <span>New role</span>
        </button>
      }
    >
      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}
      {isLoading ? (
        <p className="surface-card-subtitle">Loading roles…</p>
      ) : !roles.length ? (
        <p className="surface-card-subtitle">No roles yet. Click "New role" to start.</p>
      ) : (
        <div className="permission-matrix-wrapper">
          <table className="permission-matrix">
            <thead>
              <tr>
                <th className="permission-matrix-corner">Permission</th>
                {roles.map((role) => (
                  <th key={role.id} className="permission-matrix-role">
                    <div className="permission-matrix-role-head">
                      <span>{role.name}</span>
                      {role.isSystemRole ? (
                        <Lock aria-label="System role" data-tooltip="System role — locked" size={10} />
                      ) : (
                        <span className="permission-matrix-role-actions">
                          <button
                            aria-label={`Edit ${role.name}`}
                            className="permission-matrix-role-edit"
                            data-tooltip={`Edit ${role.name}`}
                            onClick={() => {
                              setEditingRole(role);
                              setEditDraft({ name: role.name, description: role.description ?? "" });
                            }}
                            type="button"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            aria-label={`Delete ${role.name}`}
                            className="permission-matrix-role-delete"
                            data-tooltip={`Delete ${role.name}`}
                            onClick={() => setPendingDeleteRole(role)}
                            type="button"
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPermissions.map((permission) => {
                const group = groupForKey(permission.key);
                const showGroup = group !== lastGroup;
                lastGroup = group;
                return (
                  <tr key={permission.id}>
                    <td className="permission-matrix-permission">
                      {showGroup ? <span className="permission-matrix-group">{group}</span> : null}
                      <span className="permission-matrix-permission-label">{permission.label}</span>
                      <span className="permission-matrix-permission-key">{permission.key}</span>
                    </td>
                    {roles.map((role) => {
                      const has = role.permissionIds.includes(permission.id);
                      const cellKey = `${role.id}:${permission.id}`;
                      const isPending = pendingCellKey === cellKey;
                      return (
                        <td
                          key={role.id}
                          className={`permission-matrix-cell${has ? " is-allowed" : " is-denied"}${role.isSystemRole ? " is-locked" : " is-editable"}`}
                        >
                          <button
                            aria-label={
                              role.isSystemRole
                                ? `${role.name} ${has ? "has" : "does not have"} ${permission.key}`
                                : `${has ? "Revoke" : "Grant"} ${permission.key} for ${role.name}`
                            }
                            className="permission-matrix-cell-button"
                            data-tooltip={role.isSystemRole ? "System role — locked" : has ? "Click to revoke" : "Click to grant"}
                            disabled={isPending || role.isSystemRole}
                            onClick={() => void handleToggle(role, permission)}
                            type="button"
                          >
                            {has ? "✓" : "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createDialogOpen ? (
        <div aria-modal="true" className="confirm-dialog-backdrop" role="dialog">
          <div className="confirm-dialog">
            <div className="confirm-dialog-header">
              <div className="confirm-dialog-copy">
                <strong>New custom role</strong>
                <p>Once created, toggle the permissions you want this role to have.</p>
              </div>
            </div>

            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">Role name</span>
                <input
                  autoFocus
                  className="field-input"
                  onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Production assistant"
                  value={createDraft.name}
                />
              </label>
              <label className="field-block">
                <span className="field-label">Description (optional)</span>
                <input
                  className="field-input"
                  onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Daily on-set helper. Read access only."
                  value={createDraft.description}
                />
              </label>
            </div>

            <div className="confirm-dialog-actions">
              <button
                className="ghost-control"
                disabled={isCreating}
                onClick={() => {
                  setCreateDialogOpen(false);
                  setCreateDraft({ name: "", description: "" });
                }}
                type="button"
              >
                Cancel
              </button>
              <button className="action-primary-button" disabled={isCreating} onClick={() => void handleCreate()} type="button">
                {isCreating ? "Creating…" : "Create role"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingRole ? (
        <div aria-modal="true" className="confirm-dialog-backdrop" role="dialog">
          <div className="confirm-dialog">
            <div className="confirm-dialog-header">
              <div className="confirm-dialog-copy">
                <strong>Edit role</strong>
                <p>Rename the role and refine its description. Permissions stay as they are.</p>
              </div>
            </div>

            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">Role name</span>
                <input
                  autoFocus
                  className="field-input"
                  onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))}
                  value={editDraft.name}
                />
              </label>
              <label className="field-block">
                <span className="field-label">Description (optional)</span>
                <input
                  className="field-input"
                  onChange={(event) =>
                    setEditDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  value={editDraft.description}
                />
              </label>
            </div>

            <div className="confirm-dialog-actions">
              <button
                className="ghost-control"
                disabled={isSavingEdit}
                onClick={() => setEditingRole(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="action-primary-button"
                disabled={isSavingEdit}
                onClick={() => void handleSaveEdit()}
                type="button"
              >
                {isSavingEdit ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteRole)}
        tone="danger"
        title={`Delete role "${pendingDeleteRole?.name ?? ""}"?`}
        body="Members currently assigned to this role lose its access. Other roles are not affected."
        confirmLabel="Delete role"
        cancelLabel="Keep role"
        isSubmitting={isDeletingRole}
        onConfirm={handleDelete}
        onCancel={() => setPendingDeleteRole(null)}
      />
    </SurfaceCard>
  );
};
