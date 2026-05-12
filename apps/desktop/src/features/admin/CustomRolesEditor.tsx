import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useTranslation } from "react-i18next";
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

const PERMISSION_GROUP_KEYS = [
  "projects",
  "assets",
  "incidents",
  "packing",
  "finance",
  "rma",
  "team",
  "other",
] as const;
type PermissionGroupKey = (typeof PERMISSION_GROUP_KEYS)[number];

const groupKeyForPermission = (permissionKey: string): PermissionGroupKey => {
  if (permissionKey.startsWith("projects.")) return "projects";
  if (permissionKey.startsWith("assets.") || permissionKey.startsWith("licenses.")) return "assets";
  if (permissionKey.startsWith("incidents.")) return "incidents";
  if (permissionKey.startsWith("packing-slips.")) return "packing";
  if (permissionKey.startsWith("finance.")) return "finance";
  if (permissionKey.startsWith("rma.")) return "rma";
  if (permissionKey.startsWith("users.")) return "team";
  return "other";
};

export const CustomRolesEditor = ({ supabase, workspaceId }: CustomRolesEditorProps) => {
  const { t } = useTranslation();
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
      setError(getUserFacingErrorMessage(nextError, t("settings.workspace.rolesEditor.toasts.couldNotLoad")));
    } finally {
      setIsLoading(false);
    }
  }, [supabase, workspaceId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sortedPermissions = useMemo(() => {
    return [...allPermissions].sort((a, b) => {
      const groupA = groupKeyForPermission(a.key);
      const groupB = groupKeyForPermission(b.key);
      if (groupA !== groupB) {
        return PERMISSION_GROUP_KEYS.indexOf(groupA) - PERMISSION_GROUP_KEYS.indexOf(groupB);
      }
      return a.key.localeCompare(b.key);
    });
  }, [allPermissions]);

  const handleToggle = async (role: RolePermissionRow, permission: PermissionDefinition) => {
    if (role.isSystemRole) {
      toast.info(
        t("settings.workspace.rolesEditor.toasts.systemRoleTitle"),
        t("settings.workspace.rolesEditor.toasts.systemRoleBody"),
      );
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
      toast.error(
        t("settings.workspace.rolesEditor.toasts.couldNotSave"),
        getUserFacingErrorMessage(nextError, t("settings.workspace.rolesEditor.toasts.permissionRejected")),
      );
    } finally {
      setPendingCellKey(null);
    }
  };

  const handleCreate = async () => {
    const name = createDraft.name.trim();
    if (!name) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.nameRequiredTitle"),
        t("settings.workspace.rolesEditor.toasts.nameRequiredBody"),
      );
      return;
    }
    const key = slugify(name);
    if (!key) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.invalidNameTitle"),
        t("settings.workspace.rolesEditor.toasts.invalidNameBody"),
      );
      return;
    }
    if (roles.some((role) => role.key === key)) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.alreadyExistsTitle"),
        t("settings.workspace.rolesEditor.toasts.alreadyExistsKey"),
      );
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
      toast.success(
        t("settings.workspace.rolesEditor.toasts.createdTitle"),
        t("settings.workspace.rolesEditor.toasts.createdBody", { name }),
      );
      setCreateDialogOpen(false);
      setCreateDraft({ name: "", description: "" });
      await refresh();
    } catch (nextError) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.couldNotCreate"),
        getUserFacingErrorMessage(nextError, t("settings.workspace.rolesEditor.toasts.couldNotCreateBody")),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingRole) return;
    const name = editDraft.name.trim();
    if (!name) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.nameRequiredTitle"),
        t("settings.workspace.rolesEditor.toasts.nameRequiredBody"),
      );
      return;
    }
    if (
      roles.some((role) => role.id !== editingRole.id && role.name.toLowerCase() === name.toLowerCase())
    ) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.alreadyExistsTitle"),
        t("settings.workspace.rolesEditor.toasts.alreadyExistsName"),
      );
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateCustomRole(supabase, {
        roleId: editingRole.id,
        name,
        description: editDraft.description.trim(),
      });
      toast.success(
        t("settings.workspace.rolesEditor.toasts.updatedTitle"),
        t("settings.workspace.rolesEditor.toasts.updatedBody", { name }),
      );
      setEditingRole(null);
      await refresh();
    } catch (nextError) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.couldNotUpdate"),
        getUserFacingErrorMessage(nextError, t("common.tryAgain")),
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteRole) return;
    setIsDeletingRole(true);
    try {
      await deleteCustomRole(supabase, pendingDeleteRole.id);
      toast.success(
        t("settings.workspace.rolesEditor.toasts.deletedTitle"),
        t("settings.workspace.rolesEditor.toasts.deletedBody", { name: pendingDeleteRole.name }),
      );
      setPendingDeleteRole(null);
      await refresh();
    } catch (nextError) {
      toast.error(
        t("settings.workspace.rolesEditor.toasts.couldNotDelete"),
        getUserFacingErrorMessage(nextError, t("settings.workspace.rolesEditor.toasts.couldNotDeleteBody")),
      );
    } finally {
      setIsDeletingRole(false);
    }
  };

  let lastGroup: PermissionGroupKey | "" = "";

  return (
    <SurfaceCard
      title={t("settings.workspace.rolesEditor.cardTitle")}
      subtitle={t("settings.workspace.rolesEditor.cardSubtitle")}
      aside={
        <button
          className="action-primary-button"
          disabled={isLoading}
          onClick={() => setCreateDialogOpen(true)}
          type="button"
        >
          <Plus size={13} />
          <span>{t("settings.workspace.rolesEditor.newRole")}</span>
        </button>
      }
    >
      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}
      {isLoading ? (
        <p className="surface-card-subtitle">{t("settings.workspace.rolesEditor.loading")}</p>
      ) : !roles.length ? (
        <p className="surface-card-subtitle">{t("settings.workspace.rolesEditor.empty")}</p>
      ) : (
        <div className="permission-matrix-wrapper">
          <table className="permission-matrix">
            <thead>
              <tr>
                <th className="permission-matrix-corner">{t("settings.workspace.rolesEditor.permissionColumn")}</th>
                {roles.map((role) => (
                  <th key={role.id} className="permission-matrix-role">
                    <div className="permission-matrix-role-head">
                      <span>{role.name}</span>
                      {role.isSystemRole ? (
                        <Lock
                          aria-label={t("settings.workspace.rolesEditor.tooltips.systemRole")}
                          data-tooltip={t("settings.workspace.rolesEditor.systemRoleLocked")}
                          size={10}
                        />
                      ) : (
                        <span className="permission-matrix-role-actions">
                          <button
                            aria-label={t("settings.workspace.rolesEditor.tooltips.edit", { name: role.name })}
                            className="permission-matrix-role-edit"
                            data-tooltip={t("settings.workspace.rolesEditor.tooltips.edit", { name: role.name })}
                            onClick={() => {
                              setEditingRole(role);
                              setEditDraft({ name: role.name, description: role.description ?? "" });
                            }}
                            type="button"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            aria-label={t("settings.workspace.rolesEditor.tooltips.delete", { name: role.name })}
                            className="permission-matrix-role-delete"
                            data-tooltip={t("settings.workspace.rolesEditor.tooltips.delete", { name: role.name })}
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
                const group = groupKeyForPermission(permission.key);
                const showGroup = group !== lastGroup;
                lastGroup = group;
                return (
                  <tr key={permission.id}>
                    <td className="permission-matrix-permission">
                      {showGroup ? (
                        <span className="permission-matrix-group">
                          {t(`settings.workspace.rolesEditor.groups.${group}`)}
                        </span>
                      ) : null}
                      <span className="permission-matrix-permission-label">{permission.label}</span>
                      <span className="permission-matrix-permission-key">{permission.key}</span>
                    </td>
                    {roles.map((role) => {
                      const has = role.permissionIds.includes(permission.id);
                      const cellKey = `${role.id}:${permission.id}`;
                      const isPending = pendingCellKey === cellKey;
                      const ariaLabel = role.isSystemRole
                        ? has
                          ? t("settings.workspace.rolesEditor.aria.systemHas", { role: role.name, permission: permission.key })
                          : t("settings.workspace.rolesEditor.aria.systemMissing", { role: role.name, permission: permission.key })
                        : has
                          ? t("settings.workspace.rolesEditor.aria.revoke", { role: role.name, permission: permission.key })
                          : t("settings.workspace.rolesEditor.aria.grant", { role: role.name, permission: permission.key });
                      const tooltip = role.isSystemRole
                        ? t("settings.workspace.rolesEditor.systemRoleLocked")
                        : has
                          ? t("settings.workspace.rolesEditor.tooltips.revoke")
                          : t("settings.workspace.rolesEditor.tooltips.grant");
                      return (
                        <td
                          key={role.id}
                          className={`permission-matrix-cell${has ? " is-allowed" : " is-denied"}${role.isSystemRole ? " is-locked" : " is-editable"}`}
                        >
                          <button
                            aria-label={ariaLabel}
                            className="permission-matrix-cell-button"
                            data-tooltip={tooltip}
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
                <strong>{t("settings.workspace.rolesEditor.create.title")}</strong>
                <p>{t("settings.workspace.rolesEditor.create.subtitle")}</p>
              </div>
            </div>

            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">{t("settings.workspace.rolesEditor.create.nameLabel")}</span>
                <input
                  autoFocus
                  className="field-input"
                  onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t("settings.workspace.rolesEditor.create.namePlaceholder")}
                  value={createDraft.name}
                />
              </label>
              <label className="field-block">
                <span className="field-label">{t("settings.workspace.rolesEditor.create.descriptionLabel")}</span>
                <input
                  className="field-input"
                  onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder={t("settings.workspace.rolesEditor.create.descriptionPlaceholder")}
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
                {t("settings.workspace.rolesEditor.create.cancel")}
              </button>
              <button className="action-primary-button" disabled={isCreating} onClick={() => void handleCreate()} type="button">
                {isCreating
                  ? t("settings.workspace.rolesEditor.create.submitting")
                  : t("settings.workspace.rolesEditor.create.submit")}
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
                <strong>{t("settings.workspace.rolesEditor.edit.title")}</strong>
                <p>{t("settings.workspace.rolesEditor.edit.subtitle")}</p>
              </div>
            </div>

            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">{t("settings.workspace.rolesEditor.edit.nameLabel")}</span>
                <input
                  autoFocus
                  className="field-input"
                  onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))}
                  value={editDraft.name}
                />
              </label>
              <label className="field-block">
                <span className="field-label">{t("settings.workspace.rolesEditor.edit.descriptionLabel")}</span>
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
                {t("settings.workspace.rolesEditor.edit.cancel")}
              </button>
              <button
                className="action-primary-button"
                disabled={isSavingEdit}
                onClick={() => void handleSaveEdit()}
                type="button"
              >
                {isSavingEdit
                  ? t("settings.workspace.rolesEditor.edit.submitting")
                  : t("settings.workspace.rolesEditor.edit.submit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteRole)}
        tone="danger"
        title={t("settings.workspace.rolesEditor.deleteDialog.title", { name: pendingDeleteRole?.name ?? "" })}
        body={t("settings.workspace.rolesEditor.deleteDialog.body")}
        confirmLabel={t("settings.workspace.rolesEditor.deleteDialog.confirm")}
        cancelLabel={t("settings.workspace.rolesEditor.deleteDialog.cancel")}
        isSubmitting={isDeletingRole}
        onConfirm={handleDelete}
        onCancel={() => setPendingDeleteRole(null)}
      />
    </SurfaceCard>
  );
};
