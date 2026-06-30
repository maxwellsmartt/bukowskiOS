import { Boxes, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogAssetOptionRow } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { deleteCatalogEntity, useCatalogData } from "@features/projects/useProjectsData";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useConfirmDialog } from "@shared/hooks/useConfirmDialog";
import { notifyWorkspaceDataChanged } from "@shared/hooks/useWorkspaceDataRefresh";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

export const KitsPage = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { data: catalog, isLoading, reload } = useCatalogData({
    workspaceId: activeWorkspaceId,
    entityType: "kit",
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  });

  const assetById = useMemo(() => {
    const map = new Map<string, CatalogAssetOptionRow>();
    catalog.assetOptions.forEach((asset) => map.set(asset.id, asset));
    return map;
  }, [catalog.assetOptions]);

  const kits = catalog.kits;

  const handleDisband = async (kitId: string, kitName: string) => {
    const confirmed = await confirm({
      title: t("assets.kits.disband.title", { defaultValue: "¿Desarmar este kit?" }),
      body: t("assets.kits.disband.message", {
        defaultValue: 'Los equipos de "{{name}}" vuelven a estar disponibles individualmente. No se borra ningún equipo.',
        name: kitName,
      }),
      confirmLabel: t("assets.kits.disband.confirm", { defaultValue: "Desarmar kit" }),
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    try {
      await deleteCatalogEntity({ workspaceId: activeWorkspaceId, entityType: "kit", id: kitId });
      await reload();
      notifyWorkspaceDataChanged();
      toast.success(
        t("assets.kits.disband.doneTitle", { defaultValue: "Kit desarmado" }),
        t("assets.kits.disband.doneBody", { defaultValue: "Los equipos quedan disponibles de nuevo." }),
      );
    } catch (error) {
      toast.error(
        t("assets.kits.disband.failTitle", { defaultValue: "No se pudo desarmar el kit" }),
        getUserFacingErrorMessage(error, t("assets.kits.disband.failBody", { defaultValue: "Intenta de nuevo." })),
      );
    }
  };

  return (
    <div className="page-stack page-stack--fill kits-page-stack">
      <SectionHeader
        title={t("assets.kits.title", { defaultValue: "Kits" })}
        body={t("assets.kits.subtitle", {
          defaultValue:
            "Paquetes de equipos que viajan como una unidad. Un equipo dentro de un kit no se asigna individual: se mueve el kit completo.",
        })}
      />

      <div className="action-feedback action-feedback-info kits-local-notice">
        {t("assets.kits.localNotice", {
          defaultValue: "Los kits se guardan en esta computadora y aún no se sincronizan entre máquinas.",
        })}
      </div>

      <SurfaceCard className="surface-card--fill kits-register-card" title={t("assets.kits.listTitle", { defaultValue: "Kits armados" })}>
        {isLoading ? (
          <div className="empty-state">{t("assets.kits.loading", { defaultValue: "Cargando kits…" })}</div>
        ) : !kits.length ? (
          <div className="empty-state">
            {t("assets.kits.empty", {
              defaultValue: 'Aún no has armado kits. En Equipos, selecciona varios equipos y usa "Asignar a Kit".',
            })}
          </div>
        ) : (
          <div className="kit-list">
            {kits.map((kit) => (
              <div className="kit-card" key={kit.id}>
                <div className="kit-card-header">
                  <div className="kit-card-identity">
                    <span className="kit-card-icon">
                      <Boxes size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <strong className="kit-card-title">{kit.name}</strong>
                      <span className="kit-card-meta">{kit.primaryCodeValue || kit.code}</span>
                    </div>
                  </div>
                  <div className="kit-card-actions">
                    <StatusBadge tone="neutral">
                      {t("assets.kits.memberCount", { defaultValue: "{{count}} equipos", count: kit.assetCount })}
                    </StatusBadge>
                    <button className="ghost-control is-danger" onClick={() => void handleDisband(kit.id, kit.name)} type="button">
                      <Trash2 size={14} />
                      <span>{t("assets.kits.disbandShort", { defaultValue: "Desarmar" })}</span>
                    </button>
                  </div>
                </div>

                {kit.description ? <p className="kit-card-description">{kit.description}</p> : null}

                <div className="kit-card-members">
                  {kit.assetSelections.map((selection) => {
                    const member = assetById.get(selection.assetId);
                    const inUse = member ? Boolean(member.currentProject) || member.checkedOutQuantity > 0 : false;
                    return (
                      <div className="kit-member-row" key={selection.assetId}>
                        <span className="kit-member-name">{member?.name ?? selection.assetId}</span>
                        <span className="kit-member-meta">
                          {member?.code ?? ""}
                          {selection.quantity > 1 ? ` · ×${selection.quantity}` : ""}
                          {inUse ? ` · ${member?.currentProject ?? t("assets.kits.inUse", { defaultValue: "en uso" })}` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>

      {confirmDialog}
    </div>
  );
};
