import { ArrowRightLeft, PackageCheck, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export type KitCheckoutFormValue = {
  mode: "assign" | "pack";
  projectId: string;
  departmentId?: string;
  responsibleUserId?: string;
  returnDueAt?: string;
  notes?: string;
};

type KitCheckoutPanelProps = {
  kitName: string;
  kitCode: string;
  memberCount: number;
  projects: ProjectCardRow[];
  departments: CatalogSnapshot["departments"];
  users: CatalogSnapshot["users"];
  error: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (value: KitCheckoutFormValue) => Promise<void>;
};

const normalizeOptional = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export const KitCheckoutPanel = ({
  kitName,
  kitCode,
  memberCount,
  projects,
  departments,
  users,
  error,
  isSubmitting,
  onClose,
  onSubmit,
}: KitCheckoutPanelProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"assign" | "pack">("assign");
  const [projectId, setProjectId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [returnDueAt, setReturnDueAt] = useState("");
  const [notes, setNotes] = useState("");

  const canSubmit = !isSubmitting && Boolean(projectId);

  const handleSubmit = async () => {
    await onSubmit({
      mode,
      projectId,
      departmentId: normalizeOptional(departmentId),
      responsibleUserId: normalizeOptional(responsibleUserId),
      returnDueAt: normalizeOptional(returnDueAt),
      notes: normalizeOptional(notes),
    });
  };

  return (
    <SurfaceCard
      aside={
        <button aria-label={t("assets.kits.checkout.close", { defaultValue: "Cerrar" })} className="icon-ghost-control" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={t("assets.kits.checkout.title", { defaultValue: "Mover el kit completo" })}
      subtitle={t("assets.kits.checkout.subtitle", {
        defaultValue: "{{kit}} · {{count}} equipos viajan juntos.",
        kit: kitName,
        count: memberCount,
      })}
    >
      <div className="action-panel-summary">
        <span>{kitCode}</span>
        <span>{t("assets.kits.checkout.asUnit", { defaultValue: "Se mueve como una unidad" })}</span>
      </div>

      <div className="action-mode-toggle" role="tablist" aria-label={t("assets.kits.checkout.modeAria", { defaultValue: "Modo" })}>
        <button className={`action-mode-button${mode === "assign" ? " active" : ""}`} onClick={() => setMode("assign")} type="button">
          <ArrowRightLeft size={14} />
          <span>{t("assets.kits.checkout.assign", { defaultValue: "Asignar a proyecto" })}</span>
        </button>
        <button className={`action-mode-button${mode === "pack" ? " active" : ""}`} onClick={() => setMode("pack")} type="button">
          <PackageCheck size={14} />
          <span>{t("assets.kits.checkout.pack", { defaultValue: "Crear packing slip" })}</span>
        </button>
      </div>

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">{t("assets.kits.checkout.project", { defaultValue: "Proyecto" })}</span>
          <SelectField onChange={(event) => setProjectId(event.target.value)} value={projectId}>
            <option value="">{t("assets.kits.checkout.chooseProject", { defaultValue: "Elige un proyecto" })}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("assets.kits.checkout.responsible", { defaultValue: "Responsable" })}</span>
          <SelectField onChange={(event) => setResponsibleUserId(event.target.value)} value={responsibleUserId}>
            <option value="">{t("assets.kits.checkout.unassigned", { defaultValue: "Sin asignar" })}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("assets.kits.checkout.department", { defaultValue: "Departamento" })}</span>
          <SelectField onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}>
            <option value="">{t("assets.kits.checkout.noDepartment", { defaultValue: "Ninguno" })}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("assets.kits.checkout.expectedReturn", { defaultValue: "Devolución esperada" })}</span>
          <input className="action-field-control" onChange={(event) => setReturnDueAt(event.target.value)} type="datetime-local" value={returnDueAt} />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("assets.kits.checkout.notes", { defaultValue: "Notas" })}</span>
          <textarea className="action-field-control action-textarea" onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
        </label>
      </div>

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        <button className="ghost-control cancel-control" onClick={onClose} type="button">
          {t("common.cancel", { defaultValue: "Cancelar" })}
        </button>
        <button className="action-primary-button" disabled={!canSubmit} onClick={() => void handleSubmit()} type="button">
          {isSubmitting
            ? t("assets.kits.checkout.applying", { defaultValue: "Aplicando…" })
            : mode === "assign"
              ? t("assets.kits.checkout.applyAssign", { defaultValue: "Asignar kit" })
              : t("assets.kits.checkout.applyPack", { defaultValue: "Crear packing slip" })}
        </button>
      </div>
    </SurfaceCard>
  );
};
