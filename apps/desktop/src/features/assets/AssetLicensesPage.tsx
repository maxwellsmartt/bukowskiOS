import { useEffect, useMemo, useState } from "react";
import { Check, Copy, CreditCard, KeyRound, Pencil, Plus, ReceiptText, RefreshCw, Repeat2, Save, Trash2, UsersRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNotifications } from "@app/providers/NotificationsProvider";
import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

type SoftwareLicenseRow = {
  id: string;
  workspace_id: string;
  software_name: string;
  vendor: string | null;
  status: "active" | "expiring" | "expired" | "permanent" | "archived";
  license_type: "subscription" | "perpetual" | "trial" | "usage_based" | "web_service" | "other";
  seat_count: number;
  seat_assignments: string[] | null;
  license_key: string | null;
  account_email: string | null;
  starts_at: string | null;
  expires_at: string | null;
  renewal_url: string | null;
  payment_url: string | null;
  invoice_url: string | null;
  reminder_days_before: number;
  notes: string | null;
  updated_at: string;
};

type LicenseDraft = {
  softwareName: string;
  vendor: string;
  licenseType: SoftwareLicenseRow["license_type"];
  seatCount: string;
  licenseKey: string;
  accountEmail: string;
  startsAt: string;
  expiresAt: string;
  renewalUrl: string;
  paymentUrl: string;
  invoiceUrl: string;
  reminderDaysBefore: string;
  seatAssignments: string;
  notes: string;
};

const emptyDraft: LicenseDraft = {
  softwareName: "",
  vendor: "",
  licenseType: "subscription",
  seatCount: "1",
  licenseKey: "",
  accountEmail: "",
  startsAt: "",
  expiresAt: "",
  renewalUrl: "",
  paymentUrl: "",
  invoiceUrl: "",
  reminderDaysBefore: "0",
  seatAssignments: "",
  notes: "",
};

const resolveStatusTone = (status: SoftwareLicenseRow["status"]) => {
  if (status === "active" || status === "permanent") return "success" as const;
  if (status === "expiring") return "warning" as const;
  if (status === "expired") return "critical" as const;
  return "neutral" as const;
};

const deriveStatus = (license: SoftwareLicenseRow): SoftwareLicenseRow["status"] => {
  if (license.status === "archived") return "archived";
  if (license.license_type === "perpetual") return "permanent";
  if (!license.expires_at) return "active";

  const expiresAt = new Date(`${license.expires_at}T23:59:59`);
  if (!Number.isFinite(expiresAt.getTime())) return license.status;

  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= license.reminder_days_before) return "expiring";
  return "active";
};

const toOptional = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseSeatAssignments = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );

const splitSeatAssignmentLines = (value: string) => (value ? value.split(/\r?\n/) : []);

const normalizeSeatAssignments = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
};

const compactSeatAssignments = (value: string[]) => Array.from(new Set(value.map((entry) => entry.trim()).filter(Boolean)));

const buildDraftFromLicense = (license: SoftwareLicenseRow): LicenseDraft => ({
  softwareName: license.software_name,
  vendor: license.vendor ?? "",
  licenseType: license.license_type,
  seatCount: String(license.seat_count ?? 0),
  licenseKey: license.license_key ?? "",
  accountEmail: license.account_email ?? "",
  startsAt: license.starts_at ?? "",
  expiresAt: license.expires_at ?? "",
  renewalUrl: license.renewal_url ?? "",
  paymentUrl: license.payment_url ?? "",
  invoiceUrl: license.invoice_url ?? "",
  reminderDaysBefore: String(license.reminder_days_before ?? 0),
  seatAssignments: normalizeSeatAssignments(license.seat_assignments).join("\n"),
  notes: license.notes ?? "",
});

const buildLicenseReminderTitle = (softwareName: string) => `License renewal: ${softwareName}`;

const buildLicenseReminderTime = (expiresAt: string, reminderDaysBefore: number) => {
  const reminderAt = new Date(`${expiresAt}T09:00:00`);
  if (!Number.isFinite(reminderAt.getTime())) return null;

  reminderAt.setDate(reminderAt.getDate() - reminderDaysBefore);
  const minimumFutureTime = Date.now() + 60_000;
  if (reminderAt.getTime() < minimumFutureTime) {
    reminderAt.setTime(minimumFutureTime);
  }

  return reminderAt.toISOString();
};

export const AssetLicensesPage = () => {
  const { t } = useTranslation();
  const { supabase, isLocalFallback } = useSession();
  const { createReminder, deleteReminder, reminders, updateReminder } = useNotifications();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const { formatDate: formatDateLocale } = useLocale();
  const formatDate = (value: string | null) => {
    if (!value) return t("assets.licenses.noExpiry");
    return formatDateLocale(`${value}T00:00:00`) || value;
  };
  const [rows, setRows] = useState<SoftwareLicenseRow[]>([]);
  const [draft, setDraft] = useState<LicenseDraft>(emptyDraft);
  const [editingLicenseId, setEditingLicenseId] = useState<string | null>(null);
  const [seatEditorLicenseId, setSeatEditorLicenseId] = useState<string | null>(null);
  const [seatEditorDraft, setSeatEditorDraft] = useState<string[]>([]);
  const [seatEditorBusyId, setSeatEditorBusyId] = useState<string | null>(null);
  const [copiedLicenseId, setCopiedLicenseId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadLicenses = async () => {
    if (!supabase || isLocalFallback || !activeWorkspaceId) {
      setRows([]);
      return;
    }

    setIsLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: queryError } = await (supabase as any)
        .from("software_licenses")
        .select("*")
        .eq("workspace_id", activeWorkspaceId)
        .neq("status", "archived")
        .order("expires_at", { ascending: true, nullsFirst: false })
        .order("software_name", { ascending: true });

      if (queryError) throw queryError;
      setRows(((data ?? []) as SoftwareLicenseRow[]).map((row) => ({ ...row, seat_assignments: normalizeSeatAssignments(row.seat_assignments), status: deriveStatus(row) })));
    } catch (nextError) {
      toast.error(t("assets.licenses.toasts.unavailableTitle"), getUserFacingErrorMessage(nextError, t("assets.licenses.toasts.unavailableBody")));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLicenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, isLocalFallback, supabase]);

  const summary = useMemo(
    () => ({
      total: rows.length,
      expiring: rows.filter((row) => row.status === "expiring").length,
      expired: rows.filter((row) => row.status === "expired").length,
      seats: rows.reduce((total, row) => total + (row.seat_count || 0), 0),
    }),
    [rows],
  );
  const licenseTypeOptions = useMemo(
    () =>
      (["subscription", "perpetual", "trial", "usage_based", "web_service", "other"] as const).map((value) => ({
        label: t(`assets.licenses.types.${value}`),
        value,
      })),
    [t],
  );
  const licenseTypeLabel = (value: SoftwareLicenseRow["license_type"]) => t(`assets.licenses.types.${value}`);
  const licenseStatusLabel = (value: SoftwareLicenseRow["status"]) => t(`assets.licenses.statuses.${value}`);
  const hasRequiredDraft = draft.softwareName.trim().length > 0;
  const draftSeatLimit = Math.max(0, Number.parseInt(draft.seatCount, 10) || 0);
  const draftSeatLines = splitSeatAssignmentLines(draft.seatAssignments).slice(0, draftSeatLimit);

  const updateDraft = <K extends keyof LicenseDraft>(field: K, value: LicenseDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const updateDraftSeatCount = (value: string) => {
    const nextLimit = Math.max(0, Number.parseInt(value, 10) || 0);
    setDraft((current) => ({
      ...current,
      seatAssignments: splitSeatAssignmentLines(current.seatAssignments).slice(0, nextLimit).join("\n"),
      seatCount: value,
    }));
  };

  const updateDraftSeatLine = (index: number, value: string) => {
    const nextLines = [...draftSeatLines];
    nextLines[index] = value;
    updateDraft("seatAssignments", nextLines.join("\n"));
  };

  const addDraftSeatLine = () => {
    if (draftSeatLines.length >= draftSeatLimit) return;
    updateDraft("seatAssignments", [...draftSeatLines, ""].join("\n"));
  };

  const removeDraftSeatLine = (index: number) => {
    updateDraft("seatAssignments", draftSeatLines.filter((_, entryIndex) => entryIndex !== index).join("\n"));
  };

  const syncLicenseReminder = async ({
    expiresAt,
    previousSoftwareName,
    reminderDaysBefore,
    softwareName,
  }: {
    expiresAt: string | null;
    previousSoftwareName?: string | null;
    reminderDaysBefore: number;
    softwareName: string;
  }) => {
    if (previousSoftwareName && previousSoftwareName !== softwareName) {
      const previousReminder = reminders.find((reminder) => reminder.title === buildLicenseReminderTitle(previousSoftwareName));
      if (previousReminder) {
        await deleteReminder(previousReminder.id);
      }
    }

    const existingReminder = reminders.find((reminder) => reminder.title === buildLicenseReminderTitle(softwareName));
    const reminderAt = expiresAt && reminderDaysBefore > 0 ? buildLicenseReminderTime(expiresAt, reminderDaysBefore) : null;

    if (!reminderAt) {
      if (existingReminder) {
        await deleteReminder(existingReminder.id);
      }
      return;
    }

    const body = t("assets.licenses.reminder.body", { date: formatDate(expiresAt) });
    if (existingReminder) {
      await updateReminder({
        id: existingReminder.id,
        title: existingReminder.title,
        body,
        remindAt: reminderAt,
        recurrenceRule: null,
      });
      return;
    }

    await createReminder({
      title: buildLicenseReminderTitle(softwareName),
      body,
      remindAt: reminderAt,
    });
  };

  const handleSave = async () => {
    if (!supabase || !activeWorkspaceId) return;
    if (!draft.softwareName.trim()) {
      toast.warning(t("assets.licenses.toasts.softwareRequiredTitle"), t("assets.licenses.toasts.softwareRequiredBody"));
      return;
    }

    setIsSaving(true);
    try {
      const previousLicense = editingLicenseId ? rows.find((row) => row.id === editingLicenseId) : null;
      const licenseType = draft.licenseType;
      const status = licenseType === "perpetual" ? "permanent" : "active";
      const payload = {
        workspace_id: activeWorkspaceId,
        software_name: draft.softwareName.trim(),
        vendor: toOptional(draft.vendor),
        status,
        license_type: licenseType,
        seat_count: Math.max(0, Number.parseInt(draft.seatCount, 10) || 0),
        seat_assignments: parseSeatAssignments(draft.seatAssignments),
        license_key: toOptional(draft.licenseKey),
        account_email: toOptional(draft.accountEmail),
        starts_at: licenseType === "perpetual" || licenseType === "trial" ? null : toOptional(draft.startsAt),
        expires_at: licenseType === "perpetual" || licenseType === "usage_based" ? null : toOptional(draft.expiresAt),
        renewal_url: toOptional(draft.renewalUrl),
        payment_url: toOptional(draft.paymentUrl),
        invoice_url: toOptional(draft.invoiceUrl),
        reminder_days_before: Math.max(0, Number.parseInt(draft.reminderDaysBefore, 10) || 0),
        notes: toOptional(draft.notes),
        updated_at: new Date().toISOString(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: saveError } = editingLicenseId
        ? await (supabase as any).from("software_licenses").update(payload).eq("id", editingLicenseId).eq("workspace_id", activeWorkspaceId)
        : await (supabase as any).from("software_licenses").insert(payload);

      if (saveError) throw saveError;
      await syncLicenseReminder({
        expiresAt: payload.expires_at,
        previousSoftwareName: previousLicense?.software_name ?? null,
        reminderDaysBefore: payload.reminder_days_before,
        softwareName: payload.software_name,
      }).catch((reminderError) => {
        toast.warning(t("assets.licenses.toasts.savedWithoutReminderTitle"), getUserFacingErrorMessage(reminderError, t("assets.licenses.toasts.savedWithoutReminderBody")));
      });
      setDraft(emptyDraft);
      setEditingLicenseId(null);
      toast.success(editingLicenseId ? t("assets.licenses.toasts.updatedTitle") : t("assets.licenses.toasts.savedTitle"), draft.softwareName.trim());
      await loadLicenses();
    } catch (nextError) {
      toast.error(t("assets.licenses.toasts.saveFailedTitle"), getUserFacingErrorMessage(nextError, t("assets.licenses.toasts.saveFailedBody")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (license: SoftwareLicenseRow) => {
    setEditingLicenseId(license.id);
    setDraft(buildDraftFromLicense(license));
  };

  const handleCancelEdit = () => {
    setEditingLicenseId(null);
    setDraft(emptyDraft);
  };

  const handleArchive = async (license: SoftwareLicenseRow) => {
    if (!supabase || !activeWorkspaceId) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: archiveError } = await (supabase as any)
        .from("software_licenses")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", license.id)
        .eq("workspace_id", activeWorkspaceId);

      if (archiveError) throw archiveError;
      const reminder = reminders.find((item) => item.title === buildLicenseReminderTitle(license.software_name));
      if (reminder) {
        await deleteReminder(reminder.id).catch(() => undefined);
      }
      toast.success(t("assets.licenses.toasts.removedTitle"), license.software_name);
      if (editingLicenseId === license.id) {
        handleCancelEdit();
      }
      await loadLicenses();
    } catch (nextError) {
      toast.error(t("assets.licenses.toasts.removeFailedTitle"), getUserFacingErrorMessage(nextError, t("assets.licenses.toasts.removeFailedBody")));
    }
  };

  const startSeatEdit = (license: SoftwareLicenseRow) => {
    const normalizedAssignments = normalizeSeatAssignments(license.seat_assignments);
    setSeatEditorLicenseId(license.id);
    setSeatEditorDraft(normalizedAssignments.length ? normalizedAssignments.slice(0, license.seat_count) : license.seat_count > 0 ? [""] : []);
  };

  const cancelSeatEdit = () => {
    setSeatEditorLicenseId(null);
    setSeatEditorDraft([]);
  };

  const updateSeatEditorLine = (index: number, value: string) => {
    setSeatEditorDraft((current) => current.map((entry, entryIndex) => (entryIndex === index ? value : entry)));
  };

  const addSeatEditorLine = (license: SoftwareLicenseRow) => {
    setSeatEditorDraft((current) => {
      if (current.length >= license.seat_count) return current;
      return [...current, ""];
    });
  };

  const removeSeatEditorLine = (index: number) => {
    setSeatEditorDraft((current) => current.filter((_, entryIndex) => entryIndex !== index));
  };

  const saveSeatAssignments = async (license: SoftwareLicenseRow) => {
    if (!supabase || !activeWorkspaceId) return;
    const assignments = compactSeatAssignments(seatEditorDraft);
    if (assignments.length > license.seat_count) {
      toast.warning(
        t("assets.licenses.toasts.tooManySeatsTitle"),
        t("assets.licenses.toasts.tooManySeatsBody", {
          count: assignments.length - license.seat_count,
          license: license.software_name,
          seats: license.seat_count,
        }),
      );
      return;
    }

    setSeatEditorBusyId(license.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updatedLicense, error: updateError } = await (supabase as any)
        .from("software_licenses")
        .update({ seat_assignments: assignments, updated_at: new Date().toISOString() })
        .eq("id", license.id)
        .eq("workspace_id", activeWorkspaceId)
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updatedLicense) {
        throw new Error(t("assets.licenses.toasts.seatAccessError"));
      }
      toast.success(t("assets.licenses.toasts.seatsUpdatedTitle"), license.software_name);
      cancelSeatEdit();
      await loadLicenses();
    } catch (nextError) {
      toast.error(t("assets.licenses.toasts.seatsFailedTitle"), getUserFacingErrorMessage(nextError, t("assets.licenses.toasts.seatsFailedBody")));
    } finally {
      setSeatEditorBusyId(null);
    }
  };

  const handleCopyLicenseCode = async (license: SoftwareLicenseRow) => {
    if (!license.license_key) return;
    try {
      await navigator.clipboard.writeText(license.license_key);
      setCopiedLicenseId(license.id);
      toast.success(t("assets.licenses.toasts.codeCopiedTitle"), license.software_name);
      window.setTimeout(() => setCopiedLicenseId((current) => (current === license.id ? null : current)), 1800);
    } catch (nextError) {
      toast.error(t("assets.licenses.toasts.copyFailedTitle"), getUserFacingErrorMessage(nextError, t("assets.licenses.toasts.copyFailedBody")));
    }
  };

  const openUrl = (url: string | null) => {
    if (!url) return;
    void window.bukowskiApp?.openExternal(url);
  };

  return (
    <div className="page-stack">
      <SectionHeader title={t("assets.licenses.title")} titleTone="accent" />

      <div className="license-summary-grid">
        <SurfaceCard className="agents-health-card">
          <span className="agents-health-label">{t("assets.licenses.metrics.licenses")}</span>
          <strong className="agents-health-value">{summary.total}</strong>
        </SurfaceCard>
        <SurfaceCard className="agents-health-card">
          <span className="agents-health-label">{t("assets.licenses.metrics.expiringSoon")}</span>
          <strong className="agents-health-value">{summary.expiring}</strong>
        </SurfaceCard>
        <SurfaceCard className="agents-health-card">
          <span className="agents-health-label">{t("assets.licenses.metrics.expired")}</span>
          <strong className="agents-health-value">{summary.expired}</strong>
        </SurfaceCard>
        <SurfaceCard className="agents-health-card">
          <span className="agents-health-label">{t("assets.licenses.metrics.seats")}</span>
          <strong className="agents-health-value">{summary.seats}</strong>
        </SurfaceCard>
      </div>

      <div className="license-layout">
        <SurfaceCard
          title={t("assets.licenses.add.title")}
          aside={
            <button
              aria-label={t("assets.licenses.actions.refresh")}
              className="icon-ghost-control license-refresh-button"
              data-tooltip={t("assets.licenses.actions.refresh")}
              disabled={isLoading}
              onClick={() => void loadLicenses()}
              type="button"
            >
              <RefreshCw size={14} />
            </button>
          }
        >
          <div className="license-form-grid">
            <label className="field-block field-block-span-2">
              <span className="field-label">{t("assets.licenses.fields.software")}</span>
              <input className="field-input" onChange={(event) => updateDraft("softwareName", event.target.value)} placeholder={t("assets.licenses.placeholders.software")} value={draft.softwareName} />
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.vendor")}</span>
              <input className="field-input" onChange={(event) => updateDraft("vendor", event.target.value)} placeholder={t("assets.licenses.placeholders.vendor")} value={draft.vendor} />
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.type")}</span>
              <select className="field-input" onChange={(event) => updateDraft("licenseType", event.target.value as LicenseDraft["licenseType"])} value={draft.licenseType}>
                {licenseTypeOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.seats")}</span>
              <input className="field-input" min="0" onChange={(event) => updateDraftSeatCount(event.target.value)} type="number" value={draft.seatCount} />
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.renewalReminder")}</span>
              <input className="field-input" min="0" onChange={(event) => updateDraft("reminderDaysBefore", event.target.value)} type="number" value={draft.reminderDaysBefore} />
            </label>
            {draft.licenseType !== "perpetual" && draft.licenseType !== "trial" ? (
              <label className="field-block">
                <span className="field-label">{t("assets.licenses.fields.start")}</span>
                <input className="field-input" onChange={(event) => updateDraft("startsAt", event.target.value)} type="date" value={draft.startsAt} />
              </label>
            ) : null}
            {draft.licenseType !== "perpetual" && draft.licenseType !== "usage_based" ? (
              <label className="field-block">
                <span className="field-label">{draft.licenseType === "trial" ? t("assets.licenses.fields.trialEnds") : t("assets.licenses.fields.expires")}</span>
                <input className="field-input" onChange={(event) => updateDraft("expiresAt", event.target.value)} type="date" value={draft.expiresAt} />
              </label>
            ) : null}
            <label className="field-block field-block-span-2">
              <span className="field-label">{t("assets.licenses.fields.licenseCode")}</span>
              <input className="field-input" onChange={(event) => updateDraft("licenseKey", event.target.value)} placeholder={t("assets.licenses.placeholders.licenseCode")} value={draft.licenseKey} />
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.accountEmail")}</span>
              <input className="field-input" onChange={(event) => updateDraft("accountEmail", event.target.value)} placeholder={t("assets.licenses.placeholders.accountEmail")} value={draft.accountEmail} />
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.renewalLink")}</span>
              <input className="field-input" onChange={(event) => updateDraft("renewalUrl", event.target.value)} placeholder="https://" value={draft.renewalUrl} />
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.paymentLink")}</span>
              <input className="field-input" onChange={(event) => updateDraft("paymentUrl", event.target.value)} placeholder="https://" value={draft.paymentUrl} />
            </label>
            <label className="field-block">
              <span className="field-label">{t("assets.licenses.fields.invoiceLink")}</span>
              <input className="field-input" onChange={(event) => updateDraft("invoiceUrl", event.target.value)} placeholder="https://" value={draft.invoiceUrl} />
            </label>
            <div className="field-block field-block-span-2">
              <div className="license-seat-editor-header">
                <div>
                  <span className="field-label">{t("assets.licenses.fields.seatAssignments")}</span>
                  <small>
                    {t("assets.licenses.seats.used", { assigned: compactSeatAssignments(draftSeatLines).length, total: draftSeatLimit })}
                  </small>
                </div>
                <button className="ghost-control compact" disabled={draftSeatLines.length >= draftSeatLimit} onClick={addDraftSeatLine} type="button">
                  <Plus size={13} />
                  <span>{t("assets.licenses.actions.addSeat")}</span>
                </button>
              </div>
              {draftSeatLimit > 0 ? (
                <div className="license-seat-lines">
                  {draftSeatLines.map((seat, index) => (
                    <div key={`draft-seat-${index}`} className="license-seat-line">
                      <span className="license-seat-line-index">{index + 1}</span>
                      <input
                        aria-label={t("assets.licenses.aria.seatAssignment", { index: index + 1 })}
                        className="field-input"
                        onChange={(event) => updateDraftSeatLine(index, event.target.value)}
                        placeholder={t("assets.licenses.placeholders.seatAssignment")}
                        value={seat}
                      />
                      <button aria-label={t("assets.licenses.actions.removeSeatLine")} className="icon-ghost-control" onClick={() => removeDraftSeatLine(index)} type="button">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  {!draftSeatLines.length ? <div className="license-seat-list is-empty">{t("assets.licenses.seats.none")}</div> : null}
                </div>
              ) : (
                <div className="license-seat-list is-empty">{t("assets.licenses.seats.setSeatFirst")}</div>
              )}
            </div>
            <label className="field-block field-block-span-2">
              <span className="field-label">{t("assets.licenses.fields.notes")}</span>
              <textarea className="field-input field-textarea" onChange={(event) => updateDraft("notes", event.target.value)} placeholder={t("assets.licenses.placeholders.notes")} value={draft.notes} />
            </label>
          </div>
          <div className="license-form-actions">
            {editingLicenseId ? (
              <button className="ghost-control" onClick={handleCancelEdit} type="button">
                {t("common.cancel")}
              </button>
            ) : null}
            <button className={`primary-control license-save-button${hasRequiredDraft ? " is-ready" : ""}`} disabled={isSaving} onClick={() => void handleSave()} type="button">
              {isSaving ? <Save size={14} /> : <Plus size={14} />}
              <span>{isSaving ? t("common.saving") : editingLicenseId ? t("common.saveChanges") : t("assets.licenses.actions.addLicense")}</span>
            </button>
          </div>
        </SurfaceCard>

        <SurfaceCard className="license-register-card" title={t("assets.licenses.register.title")}>
          {isLoading ? <div className="empty-state">{t("assets.licenses.register.loading")}</div> : null}
          {!isLoading && !rows.length ? (
            <div className="empty-state">{t("assets.licenses.register.empty")}</div>
          ) : (
            <div className="license-list">
              {rows.map((license) => {
                const assignedSeats = normalizeSeatAssignments(license.seat_assignments);
                const availableSeats = Math.max(0, license.seat_count - assignedSeats.length);
                const isEditingSeats = seatEditorLicenseId === license.id;
                const canAddSeatLine = isEditingSeats && seatEditorDraft.length < license.seat_count;

                return (
                  <article key={license.id} className={`license-row tone-${license.status}${assignedSeats.length ? " is-seat-active" : ""}`}>
                    <div className="license-card-topline">
                      <div className="license-row-main">
                        <span className="inbox-row-icon">
                          <KeyRound size={14} />
                        </span>
                        <div>
                          <strong>{license.software_name}</strong>
                          <span>{[license.vendor, license.account_email].filter(Boolean).join(" · ") || t("assets.licenses.register.noVendorDetails")}</span>
                        </div>
                      </div>

                      <div className="license-row-actions">
                        <button className="icon-ghost-control" data-tooltip={t("assets.licenses.actions.renewal")} disabled={!license.renewal_url} onClick={() => openUrl(license.renewal_url)} type="button">
                          <Repeat2 size={14} />
                        </button>
                        <button className="icon-ghost-control" data-tooltip={t("assets.licenses.actions.payment")} disabled={!license.payment_url} onClick={() => openUrl(license.payment_url)} type="button">
                          <CreditCard size={14} />
                        </button>
                        <button className="icon-ghost-control" data-tooltip={t("assets.licenses.actions.invoice")} disabled={!license.invoice_url} onClick={() => openUrl(license.invoice_url)} type="button">
                          <ReceiptText size={14} />
                        </button>
                        <button className="icon-ghost-control" data-tooltip={t("common.edit")} onClick={() => handleEdit(license)} type="button">
                          <Pencil size={14} />
                        </button>
                        <button className="icon-ghost-control danger-icon-control" data-tooltip={t("common.delete")} onClick={() => void handleArchive(license)} type="button">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="license-row-meta">
                      <StatusBadge tone={resolveStatusTone(license.status)}>{licenseStatusLabel(license.status)}</StatusBadge>
                      <span>{licenseTypeLabel(license.license_type)}</span>
                      <span>{formatDate(license.expires_at)}</span>
                    </div>

                    <div className="license-seat-summary">
                      <div>
                        <span className="license-code-label">{t("assets.licenses.fields.seats")}</span>
                        <strong>
                          {t("assets.licenses.seats.assigned", { assigned: assignedSeats.length, total: license.seat_count })}
                        </strong>
                        <small>{t("assets.licenses.seats.available", { count: availableSeats })}</small>
                      </div>
                      <button className="ghost-control license-seat-edit-button" onClick={() => startSeatEdit(license)} type="button">
                        <UsersRound size={13} />
                        <span>{t("assets.licenses.actions.assignSeats")}</span>
                      </button>
                    </div>

                    {isEditingSeats ? (
                      <div className="license-seat-editor">
                        <div className="license-seat-editor-header">
                          <div>
                            <span className="field-label">{t("assets.licenses.fields.assignedSeats")}</span>
                            <small>
                              {t("assets.licenses.seats.used", { assigned: compactSeatAssignments(seatEditorDraft).length, total: license.seat_count })}
                            </small>
                          </div>
                          <button className="ghost-control compact" disabled={!canAddSeatLine} onClick={() => addSeatEditorLine(license)} type="button">
                            <Plus size={13} />
                            <span>{t("assets.licenses.actions.addSeat")}</span>
                          </button>
                        </div>
                        {license.seat_count > 0 ? (
                          <div className="license-seat-lines">
                            {seatEditorDraft.map((seat, index) => (
                              <div key={`${license.id}-seat-${index}`} className="license-seat-line">
                                <span className="license-seat-line-index">{index + 1}</span>
                                <input
                                  aria-label={t("assets.licenses.aria.seatAssignment", { index: index + 1 })}
                                  className="field-input"
                                  onChange={(event) => updateSeatEditorLine(index, event.target.value)}
                                  placeholder={t("assets.licenses.placeholders.seatAssignment")}
                                  value={seat}
                                />
                                <button aria-label={t("assets.licenses.actions.removeSeatLine")} className="icon-ghost-control" onClick={() => removeSeatEditorLine(index)} type="button">
                                  <X size={13} />
                                </button>
                              </div>
                            ))}
                            {!seatEditorDraft.length ? <div className="license-seat-list is-empty">{t("assets.licenses.seats.noLines")}</div> : null}
                          </div>
                        ) : (
                          <div className="license-seat-list is-empty">{t("assets.licenses.seats.setLicenseSeatFirst")}</div>
                        )}
                        <div className="license-seat-editor-actions">
                          <button className="ghost-control" onClick={cancelSeatEdit} type="button">
                            <X size={13} />
                            <span>{t("common.cancel")}</span>
                          </button>
                          <button
                            className="primary-control"
                            disabled={seatEditorBusyId === license.id}
                            onClick={() => void saveSeatAssignments(license)}
                            type="button"
                          >
                            <Save size={13} />
                            <span>{seatEditorBusyId === license.id ? t("common.saving") : t("assets.licenses.actions.saveSeats")}</span>
                          </button>
                        </div>
                      </div>
                    ) : assignedSeats.length ? (
                      <div className="license-seat-list">
                        {assignedSeats.slice(0, 6).map((seat) => (
                          <span key={seat}>{seat}</span>
                        ))}
                        {assignedSeats.length > 6 ? <span>{t("assets.licenses.seats.more", { count: assignedSeats.length - 6 })}</span> : null}
                      </div>
                    ) : (
                      <div className="license-seat-list is-empty">{t("assets.licenses.seats.none")}</div>
                    )}

                    <div className="license-code-row">
                      <span className="license-code-label">{t("assets.licenses.fields.code")}</span>
                      <code>{license.license_key ?? t("assets.licenses.register.notAdded")}</code>
                      {license.license_key ? (
                        <button
                          aria-label={t("assets.licenses.actions.copyCode")}
                          className="icon-ghost-control"
                          data-tooltip={copiedLicenseId === license.id ? t("common.copied") : t("assets.licenses.actions.copyCode")}
                          onClick={() => void handleCopyLicenseCode(license)}
                          type="button"
                        >
                          {copiedLicenseId === license.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};
