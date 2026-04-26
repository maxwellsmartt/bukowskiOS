import { FileText, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { CatalogEntityType, CatalogSnapshot, CreateCatalogEntityInput, UpdateCatalogEntityInput } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { formatAssetStockInline } from "@shared/lib/assetQuantityPresentation";

type WithoutWorkspace<T> = T extends unknown ? Omit<T, "workspaceId"> : never;
type CatalogEditorSubmitInput = WithoutWorkspace<CreateCatalogEntityInput | UpdateCatalogEntityInput>;

type CatalogEditorPanelProps = {
  assetOptions: CatalogSnapshot["assetOptions"];
  crewDocuments?: CatalogSnapshot["crewMembers"][number]["documents"];
  departmentOptions?: CatalogSnapshot["departments"];
  userOptions?: CatalogSnapshot["users"];
  entityType: CatalogEntityType;
  error: string | null;
  initialValue?: Record<string, unknown> | null;
  isSubmitting: boolean;
  isUploadingCrewDocuments?: boolean;
  mode: "create" | "edit";
  onClose: () => void;
  onDeleteCrewDocument?: (fileId: string) => Promise<void>;
  onOpenCrewDocument?: (fileId: string) => Promise<void>;
  onSubmit: (input: CatalogEditorSubmitInput) => Promise<void>;
  onUploadCrewDocuments?: () => Promise<void>;
  onUploadCrewDocumentsFromPaths?: (filePaths: string[]) => Promise<void>;
};

type CrewBankAccountDraft = {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  accountType: string;
  routingNumber: string;
  notes: string;
  maskInPreview: boolean;
};

type KitAssetSelectionDraft = {
  assetId: string;
  quantity: number;
};

const locationTypeOptions = ["warehouse", "set", "maintenance", "office", "external"] as const;

const readString = (value: Record<string, unknown> | null | undefined, key: string) =>
  typeof value?.[key] === "string" ? (value[key] as string) : "";

const readStringArray = (value: Record<string, unknown> | null | undefined, key: string) =>
  Array.isArray(value?.[key]) ? (value[key] as string[]) : [];

const readKitAssetSelections = (value: Record<string, unknown> | null | undefined): KitAssetSelectionDraft[] =>
  Array.isArray(value?.assetSelections)
    ? (value.assetSelections as Array<Record<string, unknown>>)
        .map((entry) => ({
          assetId: typeof entry.assetId === "string" ? entry.assetId : "",
          quantity: typeof entry.quantity === "number" ? entry.quantity : 1,
        }))
        .filter((entry) => entry.assetId.trim())
    : readStringArray(value, "assetIds").map((assetId) => ({
        assetId,
        quantity: 1,
      }));

const readBankAccounts = (value: Record<string, unknown> | null | undefined): CrewBankAccountDraft[] =>
  Array.isArray(value?.bankAccounts)
    ? (value.bankAccounts as Array<Record<string, unknown>>).map((entry) => ({
        bankName: typeof entry.bankName === "string" ? entry.bankName : "",
        accountHolder: typeof entry.accountHolder === "string" ? entry.accountHolder : "",
        accountNumber: typeof entry.accountNumber === "string" ? entry.accountNumber : "",
        accountType: typeof entry.accountType === "string" ? entry.accountType : "",
        routingNumber: typeof entry.routingNumber === "string" ? entry.routingNumber : "",
        notes: typeof entry.notes === "string" ? entry.notes : "",
        maskInPreview: entry.maskInPreview === false ? false : true,
      }))
    : [];

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : undefined;
};

const parseDroppedFilePaths = (dataTransfer: DataTransfer) => {
  const directPaths = Array.from(dataTransfer.files)
    .map((file) => ((file as File & { path?: string }).path ?? "").trim())
    .filter(Boolean);

  if (directPaths.length) {
    return directPaths;
  }

  const uriPayload = [dataTransfer.getData("text/uri-list"), dataTransfer.getData("public.file-url"), dataTransfer.getData("text/plain")]
    .filter(Boolean)
    .join("\n");

  if (!uriPayload.trim()) {
    return [];
  }

  return uriPayload
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith("#"))
    .map((entry) => {
      if (!entry.startsWith("file://")) {
        return "";
      }

      try {
        return decodeURIComponent(entry.replace(/^file:\/\//, ""));
      } catch {
        return "";
      }
    })
    .filter(Boolean);
};

const getPanelTitle = (entityType: CatalogEntityType, mode: "create" | "edit") => {
  const labelMap: Record<CatalogEntityType, string> = {
    location: "location",
    department: "department",
    crew: "crew member",
    client: "client",
    production_company: "production company",
    manufacturer: "manufacturer",
    category: "category",
    kit: "kit",
  };

  return mode === "create" ? `New ${labelMap[entityType]}` : `Edit ${labelMap[entityType]}`;
};

const createEmptyBankAccount = (): CrewBankAccountDraft => ({
  bankName: "",
  accountHolder: "",
  accountNumber: "",
  accountType: "",
  routingNumber: "",
  notes: "",
  maskInPreview: true,
});

export const CatalogEditorPanel = ({
  assetOptions,
  crewDocuments = [],
  departmentOptions = [],
  userOptions = [],
  entityType,
  error,
  initialValue,
  isSubmitting,
  isUploadingCrewDocuments = false,
  mode,
  onClose,
  onDeleteCrewDocument,
  onOpenCrewDocument,
  onSubmit,
  onUploadCrewDocuments,
  onUploadCrewDocumentsFromPaths,
}: CatalogEditorPanelProps) => {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [locationType, setLocationType] = useState("warehouse");
  const [roleLabel, setRoleLabel] = useState("");
  const [primaryDepartmentId, setPrimaryDepartmentId] = useState("");
  const [linkedUserId, setLinkedUserId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [kitAssetSelections, setKitAssetSelections] = useState<KitAssetSelectionDraft[]>([]);
  const [bankAccounts, setBankAccounts] = useState<CrewBankAccountDraft[]>([]);
  const [isCrewDropActive, setIsCrewDropActive] = useState(false);
  const canManageCrewDocuments = mode === "edit" && typeof initialValue?.id === "string";

  const departmentSelectOptions = useMemo(() => departmentOptions, [departmentOptions]);
  const linkedUserOptions = useMemo(() => userOptions, [userOptions]);

  useEffect(() => {
    setCode(readString(initialValue, "code"));
    setName(entityType === "crew" ? readString(initialValue, "fullName") : readString(initialValue, "name"));
    setDescription(readString(initialValue, "description"));
    setLocationType(readString(initialValue, "type") || "warehouse");
    setPrimaryDepartmentId(readString(initialValue, "primaryDepartmentId"));
    setLinkedUserId(readString(initialValue, "linkedUserId"));
    setDocumentId(readString(initialValue, "documentId"));
    setRoleLabel(readString(initialValue, "roleLabel"));
    setContactName(readString(initialValue, "contactName"));
    setEmail(entityType === "manufacturer" ? readString(initialValue, "supportEmail") : readString(initialValue, "email"));
    setPhone(readString(initialValue, "phone"));
    setNotes(readString(initialValue, "notes"));
    setKitAssetSelections(readKitAssetSelections(initialValue));
    setBankAccounts(readBankAccounts(initialValue));
  }, [entityType, initialValue]);

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
        } as CatalogEditorSubmitInput);
        return;
      case "department":
        await onSubmit({
          entityType,
          ...baseId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: normalizeOptional(description),
        } as CatalogEditorSubmitInput);
        return;
      case "crew":
        await onSubmit({
          entityType,
          ...baseId,
          fullName: name.trim(),
          primaryDepartmentId: normalizeOptional(primaryDepartmentId),
          linkedUserId: normalizeOptional(linkedUserId),
          documentId: normalizeOptional(documentId),
          roleLabel: normalizeOptional(roleLabel),
          email: normalizeOptional(email),
          phone: normalizeOptional(phone),
          notes: normalizeOptional(notes),
          bankAccounts: bankAccounts
            .filter((entry) => entry.accountNumber.trim())
            .map((entry) => ({
              bankName: normalizeOptional(entry.bankName),
              accountHolder: normalizeOptional(entry.accountHolder),
              accountNumber: entry.accountNumber.trim(),
              accountType: normalizeOptional(entry.accountType),
              routingNumber: normalizeOptional(entry.routingNumber),
              notes: normalizeOptional(entry.notes),
              maskInPreview: entry.maskInPreview,
            })),
        } as CatalogEditorSubmitInput);
        return;
      case "client":
      case "production_company":
        await onSubmit({
          entityType,
          ...baseId,
          name: name.trim(),
          contactName: normalizeOptional(contactName),
          email: normalizeOptional(email),
          phone: normalizeOptional(phone),
          notes: normalizeOptional(notes),
        } as CatalogEditorSubmitInput);
        return;
      case "manufacturer":
        await onSubmit({
          entityType,
          ...baseId,
          name: name.trim(),
          contactName: normalizeOptional(contactName),
          supportEmail: normalizeOptional(email),
          phone: normalizeOptional(phone),
          notes: normalizeOptional(notes),
        } as CatalogEditorSubmitInput);
        return;
      case "category":
        await onSubmit({
          entityType,
          ...baseId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: normalizeOptional(description),
        } as CatalogEditorSubmitInput);
        return;
      case "kit":
        await onSubmit({
          entityType,
          ...baseId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: normalizeOptional(description),
          notes: normalizeOptional(notes),
          assetIds: kitAssetSelections.map((selection) => selection.assetId),
          assetSelections: kitAssetSelections,
        } as CatalogEditorSubmitInput);
    }
  };

  const selectedKitItemCount = useMemo(
    () => kitAssetSelections.reduce((sum, selection) => sum + selection.quantity, 0),
    [kitAssetSelections],
  );
  const selectedKitMemberCount = kitAssetSelections.length;

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close catalog editor" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={getPanelTitle(entityType, mode)}
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
              <span className="action-field-label">Department</span>
              <SelectField onChange={(event) => setPrimaryDepartmentId(event.target.value)} value={primaryDepartmentId}>
                <option value="">Unassigned</option>
                {departmentSelectOptions.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} · {department.name}
                  </option>
                ))}
              </SelectField>
            </label>
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

        {entityType === "client" || entityType === "production_company" || entityType === "manufacturer" ? (
          <>
            <label className="action-field">
              <span className="action-field-label">Contact</span>
              <input className="action-field-control" onChange={(event) => setContactName(event.target.value)} value={contactName} />
            </label>
            <label className="action-field">
              <span className="action-field-label">{entityType === "manufacturer" ? "Support email" : "Email"}</span>
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
            <textarea className="action-field-control action-textarea" onChange={(event) => setDescription(event.target.value)} rows={3} value={description} />
          </label>
        ) : null}

        {entityType === "crew" || entityType === "client" || entityType === "manufacturer" || entityType === "kit" ? (
          <label className="action-field action-field-wide">
            <span className="action-field-label">Notes</span>
            <textarea
              className="action-field-control action-textarea"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional note"
              rows={3}
              value={notes}
            />
          </label>
        ) : null}
      </div>

      {entityType === "crew" ? (
        <details className="detail-disclosure" open>
          <summary className="detail-disclosure-summary">More details</summary>
          <div className="detail-disclosure-content">
            <div className="action-form-grid">
              <label className="action-field">
                <span className="action-field-label">Linked user</span>
                <SelectField onChange={(event) => setLinkedUserId(event.target.value)} value={linkedUserId}>
                  <option value="">No linked user</option>
                  {linkedUserOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
                </SelectField>
              </label>
              <label className="action-field">
                <span className="action-field-label">Document ID</span>
                <input className="action-field-control" onChange={(event) => setDocumentId(event.target.value)} value={documentId} />
              </label>
            </div>
          </div>
        </details>
      ) : null}

      {entityType === "crew" ? (
        <div className="catalog-crew-support-grid">
          <div className="catalog-crew-support-card">
            <div className="surface-card-header catalog-kit-assets-header">
              <div>
                <h3 className="surface-card-title">App access</h3>
              </div>
            </div>
            <div className="catalog-crew-support-empty">
              {linkedUserId ? `Linked to ${linkedUserOptions.find((user) => user.id === linkedUserId)?.fullName ?? linkedUserId}.` : "No app user linked yet."}
            </div>
          </div>

          <div className="catalog-crew-support-card">
            <div className="surface-card-header catalog-kit-assets-header">
              <div>
                <h3 className="surface-card-title">Bank accounts</h3>
              </div>
              <button className="ghost-control catalog-inline-button" onClick={() => setBankAccounts((current) => [...current, createEmptyBankAccount()])} type="button">
                <Plus size={14} />
                <span>Add account</span>
              </button>
            </div>

            {bankAccounts.length ? (
              <div className="catalog-crew-bank-accounts">
                {bankAccounts.map((entry, index) => (
                  <div key={`bank-account-${index}`} className="catalog-crew-bank-account">
                    <div className="catalog-crew-bank-account-header">
                      <strong>Account {index + 1}</strong>
                      <button
                        aria-label={`Remove bank account ${index + 1}`}
                        className="icon-danger-control"
                        data-tooltip="Remove bank account"
                        onClick={() => setBankAccounts((current) => current.filter((_currentEntry, currentIndex) => currentIndex !== index))}
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="action-form-grid">
                      <label className="action-field">
                        <span className="action-field-label">Bank name</span>
                        <input
                          className="action-field-control"
                          onChange={(event) =>
                            setBankAccounts((current) =>
                              current.map((currentEntry, currentIndex) =>
                                currentIndex === index ? { ...currentEntry, bankName: event.target.value } : currentEntry,
                              ),
                            )
                          }
                          value={entry.bankName}
                        />
                      </label>
                      <label className="action-field">
                        <span className="action-field-label">Account holder</span>
                        <input
                          className="action-field-control"
                          onChange={(event) =>
                            setBankAccounts((current) =>
                              current.map((currentEntry, currentIndex) =>
                                currentIndex === index ? { ...currentEntry, accountHolder: event.target.value } : currentEntry,
                              ),
                            )
                          }
                          value={entry.accountHolder}
                        />
                      </label>
                      <label className="action-field">
                        <span className="action-field-label">Account number</span>
                        <input
                          className="action-field-control"
                          onChange={(event) =>
                            setBankAccounts((current) =>
                              current.map((currentEntry, currentIndex) =>
                                currentIndex === index ? { ...currentEntry, accountNumber: event.target.value } : currentEntry,
                              ),
                            )
                          }
                          value={entry.accountNumber}
                        />
                      </label>
                      <label className="action-field">
                        <span className="action-field-label">Account type</span>
                        <input
                          className="action-field-control"
                          onChange={(event) =>
                            setBankAccounts((current) =>
                              current.map((currentEntry, currentIndex) =>
                                currentIndex === index ? { ...currentEntry, accountType: event.target.value } : currentEntry,
                              ),
                            )
                          }
                          value={entry.accountType}
                        />
                      </label>
                      <label className="action-field">
                        <span className="action-field-label">Routing / ABA</span>
                        <input
                          className="action-field-control"
                          onChange={(event) =>
                            setBankAccounts((current) =>
                              current.map((currentEntry, currentIndex) =>
                                currentIndex === index ? { ...currentEntry, routingNumber: event.target.value } : currentEntry,
                              ),
                            )
                          }
                          value={entry.routingNumber}
                        />
                      </label>
                      <label className="action-field action-field-checkbox">
                        <input
                          checked={entry.maskInPreview}
                          className="table-checkbox"
                          onChange={(event) =>
                            setBankAccounts((current) =>
                              current.map((currentEntry, currentIndex) =>
                                currentIndex === index ? { ...currentEntry, maskInPreview: event.target.checked } : currentEntry,
                              ),
                            )
                          }
                          type="checkbox"
                        />
                        <span className="action-field-label">Mask in preview</span>
                      </label>
                      <label className="action-field action-field-wide">
                        <span className="action-field-label">Notes</span>
                        <textarea
                          className="action-field-control action-textarea"
                          onChange={(event) =>
                            setBankAccounts((current) =>
                              current.map((currentEntry, currentIndex) =>
                                currentIndex === index ? { ...currentEntry, notes: event.target.value } : currentEntry,
                              ),
                            )
                          }
                          rows={2}
                          value={entry.notes}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="catalog-crew-support-empty">No bank accounts yet.</div>
            )}
          </div>

          {
            <div
              className={`catalog-crew-support-card catalog-crew-dropzone-shell${canManageCrewDocuments && isCrewDropActive ? " is-drag-active" : ""}${canManageCrewDocuments ? "" : " is-disabled"}`}
              onDragEnter={(event) => {
                if (!canManageCrewDocuments) {
                  return;
                }
                event.preventDefault();
                setIsCrewDropActive(true);
              }}
              onDragLeave={(event) => {
                if (!canManageCrewDocuments) {
                  return;
                }
                event.preventDefault();
                const nextTarget = event.relatedTarget as Node | null;
                if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                  setIsCrewDropActive(false);
                }
              }}
              onDragOver={(event) => {
                if (!canManageCrewDocuments) {
                  return;
                }
                event.preventDefault();
                setIsCrewDropActive(true);
              }}
              onDrop={(event) => {
                if (!canManageCrewDocuments) {
                  return;
                }
                event.preventDefault();
                setIsCrewDropActive(false);
                const filePaths = parseDroppedFilePaths(event.dataTransfer);

                if (filePaths.length) {
                  void onUploadCrewDocumentsFromPaths?.(filePaths);
                }
              }}
            >
              <div
                className={`surface-card-header catalog-kit-assets-header catalog-crew-dropzone${canManageCrewDocuments && isCrewDropActive ? " is-drag-active" : ""}`}
              >
                <div>
                  <h3 className="surface-card-title">Documents</h3>
                  {canManageCrewDocuments ? null : <p className="surface-card-subtitle">Save this crew profile first to attach files.</p>}
                </div>
                <button
                  className="ghost-control catalog-inline-button"
                  disabled={isUploadingCrewDocuments || !canManageCrewDocuments}
                  onClick={() => void onUploadCrewDocuments?.()}
                  type="button"
                >
                  <Plus size={14} />
                  <span>{isUploadingCrewDocuments ? "Uploading..." : "Attach files"}</span>
                </button>
              </div>

              {canManageCrewDocuments && crewDocuments.length ? (
                <div className="catalog-crew-documents-grid">
                  {crewDocuments.map((document) => (
                    <article key={document.id} className="catalog-crew-document-card">
                      <button
                        aria-label={`Remove ${document.originalName}`}
                        className="icon-danger-control catalog-crew-document-delete"
                        data-tooltip="Remove file"
                        onClick={() => void onDeleteCrewDocument?.(document.id)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button className="catalog-crew-document-open" onClick={() => void onOpenCrewDocument?.(document.id)} type="button">
                        <div className="catalog-crew-document-media">
                          {document.previewDataUrl ? (
                            document.mimeType === "application/pdf" ? (
                              <div className="catalog-crew-document-pdf">
                                <FileText size={24} />
                                <span>PDF</span>
                              </div>
                            ) : (
                              <img alt={document.originalName} className="catalog-crew-document-thumb" src={document.previewDataUrl} />
                            )
                          ) : (
                            <div className="catalog-crew-document-pdf">
                              <FileText size={24} />
                              <span>{document.fileType.toUpperCase()}</span>
                            </div>
                          )}
                        </div>
                        <div className="catalog-crew-document-copy">
                          <strong>{document.originalName}</strong>
                          <span>
                            {document.fileType.toUpperCase()} · {(document.byteSize / 1024).toFixed(document.byteSize >= 1024 ? 1 : 0)} KB
                          </span>
                        </div>
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="catalog-crew-support-empty">
                  {canManageCrewDocuments ? "No crew documents attached yet." : "Attachments will appear here after the crew member is created."}
                </div>
              )}
            </div>
          }
        </div>
      ) : null}

      {entityType === "kit" ? (
        <div className="catalog-kit-assets">
          <div className="surface-card-header catalog-kit-assets-header">
            <div>
              <h3 className="surface-card-title">Kit members</h3>
            </div>
            <span className="section-header-context-pill">
              {selectedKitMemberCount} members · {selectedKitItemCount} units
            </span>
          </div>
          <div className="catalog-asset-picker">
            {assetOptions.map((asset) => {
              const currentSelection = kitAssetSelections.find((selection) => selection.assetId === asset.id);
              const checked = Boolean(currentSelection);
              const availableQuantity = Math.max(1, asset.quantity);

              return (
                <label key={asset.id} className={`catalog-asset-option${checked ? " selected" : ""}`}>
                  <input
                    checked={checked}
                    className="table-checkbox"
                    onChange={(event) =>
                      setKitAssetSelections((current) =>
                        event.target.checked
                          ? [...current, { assetId: asset.id, quantity: 1 }]
                          : current.filter((value) => value.assetId !== asset.id),
                      )
                    }
                    type="checkbox"
                  />
                  <div className="identity-cell">
                    <span className="identity-title">{asset.name}</span>
                    <span className="identity-meta">
                      {asset.code} · {asset.category} · {asset.status}
                    </span>
                    <span className="identity-meta catalog-kit-asset-stock">
                      {formatAssetStockInline({
                        availableQuantity: asset.quantity,
                        assignedQuantity: asset.assignedQuantity,
                        checkedOutQuantity: asset.checkedOutQuantity,
                      })}
                    </span>
                    <span className="identity-meta catalog-kit-asset-context">
                      {asset.currentProject ? `Live on ${asset.currentProject}${asset.currentUnit ? ` · ${asset.currentUnit}` : ""}` : "Free in stock"}
                    </span>
                  </div>
                  {checked ? (
                    <div className="catalog-kit-quantity-field">
                      <span className="action-field-label">Qty</span>
                      <input
                        className="action-field-control"
                        max={availableQuantity}
                        min={1}
                        onChange={(event) =>
                          setKitAssetSelections((current) =>
                            current.map((selection) =>
                              selection.assetId === asset.id
                                ? {
                                    ...selection,
                                    quantity: Math.min(
                                      Math.max(Number.parseInt(event.target.value || "1", 10) || 1, 1),
                                      availableQuantity,
                                    ),
                                  }
                                : selection,
                            ),
                          )
                        }
                        type="number"
                        value={Math.min(Math.max(currentSelection?.quantity ?? 1, 1), availableQuantity)}
                      />
                    </div>
                  ) : null}
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
