import { Plus, Save, X } from "lucide-react";
import { useState } from "react";

import type { CatalogEntityType, CatalogSnapshot, CreateCatalogEntityInput, UpdateCatalogEntityInput } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

type CatalogEditorPanelProps = {
  assetOptions: CatalogSnapshot["assetOptions"];
  entityType: CatalogEntityType;
  error: string | null;
  initialValue?: Record<string, unknown> | null;
  isSubmitting: boolean;
  mode: "create" | "edit";
  onClose: () => void;
  onSubmit: (input: CreateCatalogEntityInput | UpdateCatalogEntityInput) => Promise<void>;
};

const locationTypeOptions = ["warehouse", "set", "maintenance", "office", "external"] as const;

const readString = (value: Record<string, unknown> | null | undefined, key: string) =>
  typeof value?.[key] === "string" ? (value[key] as string) : "";

const readStringArray = (value: Record<string, unknown> | null | undefined, key: string) =>
  Array.isArray(value?.[key]) ? (value[key] as string[]) : [];

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : undefined;
};

const getPanelTitle = (entityType: CatalogEntityType, mode: "create" | "edit") => {
  const labelMap: Record<CatalogEntityType, string> = {
    location: "location",
    department: "department",
    crew: "crew member",
    client: "client",
    category: "category",
    kit: "kit",
  };

  return mode === "create" ? `New ${labelMap[entityType]}` : `Edit ${labelMap[entityType]}`;
};

const getPanelSubtitle = (entityType: CatalogEntityType) => {
  switch (entityType) {
    case "location":
      return "Global locations become reusable anchors for assets, moves, returns and maintenance.";
    case "department":
      return "Departments stay global so projects can reuse the same operational structure cleanly.";
    case "crew":
      return "Crew is a reusable operational catalog, separate from auth users and permissions.";
    case "client":
      return "Clients now live as central records so projects stop depending on loose text fields.";
    case "category":
      return "Categories stay global to keep the registry consistent as inventory grows.";
    case "kit":
      return "Kits group assets that travel together and prepare future assignment and packing flows.";
  }
};

export const CatalogEditorPanel = ({
  assetOptions,
  entityType,
  error,
  initialValue,
  isSubmitting,
  mode,
  onClose,
  onSubmit,
}: CatalogEditorPanelProps) => {
  const [code, setCode] = useState(readString(initialValue, "code"));
  const [name, setName] = useState(readString(initialValue, "name"));
  const [description, setDescription] = useState(readString(initialValue, "description"));
  const [locationType, setLocationType] = useState(readString(initialValue, "type") || "warehouse");
  const [roleLabel, setRoleLabel] = useState(readString(initialValue, "roleLabel"));
  const [contactName, setContactName] = useState(readString(initialValue, "contactName"));
  const [email, setEmail] = useState(readString(initialValue, "email"));
  const [phone, setPhone] = useState(readString(initialValue, "phone"));
  const [notes, setNotes] = useState(readString(initialValue, "notes"));
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(readStringArray(initialValue, "assetIds"));

  const submit = async () => {
    const baseId = mode === "edit" && typeof initialValue?.id === "string" ? { id: initialValue.id } : {};

    switch (entityType) {
      case "location":
        await onSubmit({
          entityType,
          ...baseId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          locationType,
          description: normalizeOptional(description),
        } as CreateCatalogEntityInput | UpdateCatalogEntityInput);
        return;
      case "department":
        await onSubmit({
          entityType,
          ...baseId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: normalizeOptional(description),
        } as CreateCatalogEntityInput | UpdateCatalogEntityInput);
        return;
      case "crew":
        await onSubmit({
          entityType,
          ...baseId,
          fullName: name.trim(),
          roleLabel: normalizeOptional(roleLabel),
          email: normalizeOptional(email),
          phone: normalizeOptional(phone),
          notes: normalizeOptional(notes),
        } as CreateCatalogEntityInput | UpdateCatalogEntityInput);
        return;
      case "client":
        await onSubmit({
          entityType,
          ...baseId,
          name: name.trim(),
          contactName: normalizeOptional(contactName),
          email: normalizeOptional(email),
          phone: normalizeOptional(phone),
          notes: normalizeOptional(notes),
        } as CreateCatalogEntityInput | UpdateCatalogEntityInput);
        return;
      case "category":
        await onSubmit({
          entityType,
          ...baseId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: normalizeOptional(description),
        } as CreateCatalogEntityInput | UpdateCatalogEntityInput);
        return;
      case "kit":
        await onSubmit({
          entityType,
          ...baseId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: normalizeOptional(description),
          notes: normalizeOptional(notes),
          assetIds: selectedAssetIds,
        } as CreateCatalogEntityInput | UpdateCatalogEntityInput);
    }
  };

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close catalog editor" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={getPanelTitle(entityType, mode)}
      subtitle={getPanelSubtitle(entityType)}
    >
      <div className="action-form-grid">
        {entityType === "location" || entityType === "department" || entityType === "category" || entityType === "kit" ? (
          <label className="action-field">
            <span className="action-field-label">Code</span>
            <input className="action-field-control" onChange={(event) => setCode(event.target.value)} value={code} />
          </label>
        ) : null}

        <label className="action-field">
          <span className="action-field-label">{entityType === "crew" ? "Full name" : "Name"}</span>
          <input className="action-field-control" onChange={(event) => setName(event.target.value)} value={name} />
        </label>

        {entityType === "location" ? (
          <label className="action-field">
            <span className="action-field-label">Type</span>
            <SelectField onChange={(event) => setLocationType(event.target.value)} value={locationType}>
              {locationTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          </label>
        ) : null}

        {entityType === "crew" ? (
          <>
            <label className="action-field">
              <span className="action-field-label">Role label</span>
              <input className="action-field-control" onChange={(event) => setRoleLabel(event.target.value)} value={roleLabel} />
            </label>
            <label className="action-field">
              <span className="action-field-label">Email</span>
              <input className="action-field-control" onChange={(event) => setEmail(event.target.value)} value={email} />
            </label>
            <label className="action-field">
              <span className="action-field-label">Phone</span>
              <input className="action-field-control" onChange={(event) => setPhone(event.target.value)} value={phone} />
            </label>
          </>
        ) : null}

        {entityType === "client" ? (
          <>
            <label className="action-field">
              <span className="action-field-label">Contact</span>
              <input className="action-field-control" onChange={(event) => setContactName(event.target.value)} value={contactName} />
            </label>
            <label className="action-field">
              <span className="action-field-label">Email</span>
              <input className="action-field-control" onChange={(event) => setEmail(event.target.value)} value={email} />
            </label>
            <label className="action-field">
              <span className="action-field-label">Phone</span>
              <input className="action-field-control" onChange={(event) => setPhone(event.target.value)} value={phone} />
            </label>
          </>
        ) : null}

        {entityType !== "crew" && entityType !== "client" ? (
          <label className="action-field action-field-wide">
            <span className="action-field-label">Description</span>
            <textarea
              className="action-field-control action-textarea"
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
          </label>
        ) : null}

        {entityType === "crew" || entityType === "client" || entityType === "kit" ? (
          <label className="action-field action-field-wide">
            <span className="action-field-label">Notes</span>
            <textarea className="action-field-control action-textarea" onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
          </label>
        ) : null}
      </div>

      {entityType === "kit" ? (
        <div className="catalog-kit-assets">
          <div className="surface-card-header catalog-kit-assets-header">
            <div>
              <h3 className="surface-card-title">Kit members</h3>
              <p className="surface-card-subtitle">Choose the assets that should live together as part of this package.</p>
            </div>
            <span className="section-header-context-pill">{selectedAssetIds.length} linked</span>
          </div>
          <div className="catalog-asset-picker">
            {assetOptions.map((asset) => {
              const checked = selectedAssetIds.includes(asset.id);

              return (
                <label key={asset.id} className={`catalog-asset-option${checked ? " selected" : ""}`}>
                  <input
                    checked={checked}
                    className="table-checkbox"
                    onChange={(event) =>
                      setSelectedAssetIds((current) =>
                        event.target.checked ? Array.from(new Set([...current, asset.id])) : current.filter((value) => value !== asset.id),
                      )
                    }
                    type="checkbox"
                  />
                  <div className="identity-cell">
                    <span className="identity-title">{asset.name}</span>
                    <span className="identity-meta">
                      {asset.code} · {asset.category} · {asset.status}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        <button className="ghost-control" onClick={onClose} type="button">
          Cancel
        </button>
        <button className="action-primary-button" disabled={isSubmitting} onClick={() => void submit()} type="button">
          {mode === "create" ? <Plus size={14} /> : <Save size={14} />}
          <span>{isSubmitting ? "Saving..." : mode === "create" ? "Create" : "Save changes"}</span>
        </button>
      </div>
    </SurfaceCard>
  );
};
