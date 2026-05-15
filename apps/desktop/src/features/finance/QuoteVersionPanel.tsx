import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, RotateCcw, X } from "lucide-react";

import type { QuoteDetail, QuoteItemInput, QuoteVersionSnapshotV2 } from "@contracts";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";

import { formatCurrency, statusLabel } from "./quoteHelpers";
import type { QuoteVersionRow } from "./useQuoteData";

type QuoteVersionPanelProps = {
  version: QuoteVersionRow;
  currentQuote: QuoteDetail | null;
  /**
   * `true` when the workspace permits restore AND the current quote is
   * still in `draft` status. Other gates (e.g. schemaVersion < 2) are
   * computed locally from the snapshot.
   */
  canRestore: boolean;
  isRestoring: boolean;
  onClose: () => void;
  onRestore: () => Promise<void> | void;
};

type Tab = "detail" | "diff";

/** Type guard mirrored from the mutation service. */
const isV2Snapshot = (raw: unknown): raw is QuoteVersionSnapshotV2 =>
  Boolean(raw) &&
  typeof raw === "object" &&
  (raw as { schemaVersion?: unknown }).schemaVersion === 2 &&
  Array.isArray((raw as { items?: unknown }).items);

/**
 * Generic equality used to flag field-level changes. Numbers compare with a
 * tiny epsilon (0.005) to avoid spurious flags from REAL+2dp round trips.
 */
const equalValue = (a: unknown, b: unknown) => {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.005;
  }
  return (a ?? null) === (b ?? null);
};

type HeaderRow = { labelKey: string; oldValue: string; newValue: string; changed: boolean };

const formatBool = (value: boolean | null | undefined) =>
  value === undefined || value === null ? "—" : value ? "✓" : "✗";

const formatString = (value: string | null | undefined): string =>
  value === null || value === undefined || value === "" ? "—" : value;

const formatNumber = (value: number | null | undefined, fractionDigits = 2): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toFixed(fractionDigits);

/**
 * Compare the v2 snapshot to the live quote header field-by-field and
 * return one row per header field we care about. `changed` is set when
 * the displayed values differ.
 */
const buildHeaderDiff = (
  snapshot: QuoteVersionSnapshotV2,
  current: QuoteDetail,
): HeaderRow[] => {
  const rows: Array<[string, unknown, unknown, (v: unknown) => string]> = [
    ["client", snapshot.clientNameSnapshot, current.clientNameSnapshot, (v) => formatString(v as string)],
    [
      "productionCompany",
      snapshot.productionCompanyNameSnapshot,
      current.productionCompanyNameSnapshot,
      (v) => formatString(v as string | null),
    ],
    ["project", snapshot.projectNameSnapshot, current.projectNameSnapshot, (v) => formatString(v as string | null)],
    ["currency", snapshot.currency, current.currency, (v) => formatString(v as string)],
    ["exchangeRate", snapshot.exchangeRate, current.exchangeRate, (v) => formatNumber(v as number, 4)],
    ["taxProfile", snapshot.taxProfile, current.taxProfile, (v) => formatString(v as string)],
    ["itbisRate", snapshot.itbisRate, current.itbisRate, (v) => formatNumber((v as number) * 100, 2) + "%"],
    ["validityDays", snapshot.validityDays, current.validityDays, (v) => String(v ?? "—")],
    ["validUntil", snapshot.validUntil, current.validUntil, (v) => formatString(v as string)],
    ["packageTitle", snapshot.packageTitle, current.packageTitle, (v) => formatString(v as string | null)],
    ["observations", snapshot.observations, current.observations, (v) => formatString(v as string | null)],
  ];

  return rows.map(([key, oldRaw, newRaw, render]) => ({
    labelKey: `finance.quotes.editor.versions.headerFields.${key}`,
    oldValue: render(oldRaw),
    newValue: render(newRaw),
    changed: !equalValue(oldRaw, newRaw),
  }));
};

type ItemDiffRow =
  | { kind: "unchanged"; item: QuoteItemInput }
  | { kind: "added"; item: QuoteDetail["items"][number] }
  | { kind: "removed"; item: QuoteItemInput }
  | { kind: "changed"; before: QuoteItemInput; after: QuoteDetail["items"][number] };

/**
 * Pair snapshot items with current items by `sortOrder`. Items whose
 * `sortOrder` is unique to one side are flagged added/removed. Pairs
 * with matching sortOrder but differing values are flagged changed.
 */
const buildItemsDiff = (
  snapshot: QuoteVersionSnapshotV2,
  current: QuoteDetail,
): ItemDiffRow[] => {
  const before = new Map(snapshot.items.map((item) => [item.sortOrder, item]));
  const after = new Map(current.items.map((item) => [item.sortOrder, item]));
  const allOrders = Array.from(new Set([...before.keys(), ...after.keys()])).sort((a, b) => a - b);

  return allOrders.map<ItemDiffRow>((order) => {
    const b = before.get(order);
    const a = after.get(order);
    if (b && !a) return { kind: "removed", item: b };
    if (!b && a) return { kind: "added", item: a };
    if (b && a) {
      const sameTitle = b.title.trim() === a.title.trim();
      const sameQuantity = equalValue(b.quantity, a.quantity);
      const sameUnitPrice = equalValue(b.unitPrice, a.unitPrice);
      const sameTaxBehavior = b.taxBehavior === a.taxBehavior;
      const sameDiscountRate = equalValue(b.discountRate ?? null, a.discountRate ?? null);
      if (sameTitle && sameQuantity && sameUnitPrice && sameTaxBehavior && sameDiscountRate) {
        return { kind: "unchanged", item: b };
      }
      return { kind: "changed", before: b, after: a };
    }
    // Should not happen, but TS needs an exhaustive branch.
    return { kind: "unchanged", item: b ?? a! };
  });
};

export const QuoteVersionPanel = ({
  version,
  currentQuote,
  canRestore,
  isRestoring,
  onClose,
  onRestore,
}: QuoteVersionPanelProps) => {
  const { t } = useTranslation();
  const { language } = useLocale();
  const [tab, setTab] = useState<Tab>("detail");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Re-anchor to Detail whenever we open a different version row.
  useEffect(() => {
    setTab("detail");
    setConfirmOpen(false);
  }, [version.id]);

  const snapshot = useMemo(() => (isV2Snapshot(version.snapshot) ? version.snapshot : null), [version.snapshot]);
  const headerDiff = useMemo(
    () => (snapshot && currentQuote ? buildHeaderDiff(snapshot, currentQuote) : []),
    [snapshot, currentQuote],
  );
  const itemsDiff = useMemo(
    () => (snapshot && currentQuote ? buildItemsDiff(snapshot, currentQuote) : []),
    [snapshot, currentQuote],
  );
  const headerHasChanges = headerDiff.some((row) => row.changed);
  const itemsHaveChanges = itemsDiff.some((row) => row.kind !== "unchanged");
  const showsNoChanges = tab === "diff" && snapshot && !headerHasChanges && !itemsHaveChanges;

  const restoreDisabled = !canRestore || !snapshot || isRestoring;
  const restoreDisabledReason = (() => {
    if (!snapshot) return t("finance.quotes.editor.versions.legacyNotice");
    if (currentQuote && currentQuote.status !== "draft") {
      return t("finance.quotes.editor.versions.restoreNotDraft", {
        status: statusLabel(currentQuote.status),
      });
    }
    return null;
  })();

  const renderHeaderValue = (value: string) => (value === "" ? "—" : value);

  return (
    <>
      <SurfaceCard
        className="quote-version-panel"
        title={
          <span className="quote-version-panel-heading">
            <History size={15} aria-hidden="true" />
            {t("finance.quotes.editor.versions.panelHeading", { number: version.versionNumber })}
          </span>
        }
        subtitle={t("finance.quotes.editor.versions.createdAt", {
          value: version.createdAt.slice(0, 16).replace("T", " "),
        })}
        aside={
          <button
            type="button"
            aria-label={t("finance.quotes.editor.versions.panelClose")}
            className="surface-card-action"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        }
      >
        <div className="quote-version-panel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "detail"}
            className={`quote-version-tab${tab === "detail" ? " is-active" : ""}`}
            onClick={() => setTab("detail")}
          >
            {t("finance.quotes.editor.versions.tabDetail")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "diff"}
            className={`quote-version-tab${tab === "diff" ? " is-active" : ""}`}
            onClick={() => setTab("diff")}
            disabled={!currentQuote}
          >
            {t("finance.quotes.editor.versions.tabDiff")}
          </button>
        </div>

        {!snapshot ? (
          <p className="action-feedback action-feedback-warning quote-version-legacy">
            {t("finance.quotes.editor.versions.legacyNotice")}
          </p>
        ) : null}

        {version.changeSummary ? (
          <p className="quote-versions-summary">{version.changeSummary}</p>
        ) : null}

        {tab === "detail" && snapshot ? (
          <div className="quote-version-detail">
            <table className="quote-version-table">
              <tbody>
                {headerDiff.map((row) => (
                  <tr key={row.labelKey}>
                    <th scope="row">{t(row.labelKey)}</th>
                    <td>{renderHeaderValue(row.oldValue)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">{t("finance.quotes.editor.versions.headerFields.subtotal")}</th>
                  <td>{formatCurrency(snapshot.totals.subtotal, snapshot.currency, language)}</td>
                </tr>
                <tr>
                  <th scope="row">{t("finance.quotes.editor.versions.headerFields.discount")}</th>
                  <td>{formatCurrency(snapshot.totals.discountAmount, snapshot.currency, language)}</td>
                </tr>
                <tr>
                  <th scope="row">{t("finance.quotes.editor.versions.headerFields.tax")}</th>
                  <td>
                    {formatCurrency(snapshot.totals.taxAmount, snapshot.currency, language)}{" "}
                    {snapshot.taxAddedToTotal ? "" : "(**)"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t("finance.quotes.editor.versions.headerFields.total")}</th>
                  <td>
                    <strong>{formatCurrency(snapshot.totals.total, snapshot.currency, language)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            <h4 className="quote-version-section-title">
              {t("finance.quotes.editor.versions.itemsSectionTitle")}
            </h4>
            <table className="quote-version-table quote-version-items-table">
              <thead>
                <tr>
                  <th>{t("finance.quotes.editor.versions.itemColumns.qty")}</th>
                  <th>{t("finance.quotes.editor.versions.itemColumns.title")}</th>
                  <th>{t("finance.quotes.editor.versions.itemColumns.unitPrice")}</th>
                  <th>{t("finance.quotes.editor.versions.itemColumns.lineTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.items.map((item, index) => (
                  <tr key={`${item.sortOrder}-${index}`}>
                    <td>{item.quantity}</td>
                    <td>
                      <div>{item.title}</div>
                      {item.description ? (
                        <small className="text-muted">{item.description}</small>
                      ) : null}
                    </td>
                    <td>{formatCurrency(item.unitPrice, snapshot.currency, language)}</td>
                    <td>
                      {formatCurrency(item.quantity * item.unitPrice, snapshot.currency, language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === "diff" && snapshot && currentQuote ? (
          showsNoChanges ? (
            <p className="quote-version-no-changes">
              {t("finance.quotes.editor.versions.diffNoChanges")}
            </p>
          ) : (
            <div className="quote-version-diff">
              <table className="quote-version-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>v{version.versionNumber}</th>
                    <th>{t("finance.quotes.editor.versions.diffStatus.unchanged")} (current)</th>
                  </tr>
                </thead>
                <tbody>
                  {headerDiff.map((row) => (
                    <tr key={row.labelKey} className={row.changed ? "is-changed" : undefined}>
                      <th scope="row">{t(row.labelKey)}</th>
                      <td>{renderHeaderValue(row.oldValue)}</td>
                      <td>{renderHeaderValue(row.newValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4 className="quote-version-section-title">
                {t("finance.quotes.editor.versions.itemsSectionTitle")}
              </h4>
              <table className="quote-version-table quote-version-items-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>{t("finance.quotes.editor.versions.itemColumns.qty")}</th>
                    <th>{t("finance.quotes.editor.versions.itemColumns.title")}</th>
                    <th>{t("finance.quotes.editor.versions.itemColumns.unitPrice")}</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsDiff.map((row, index) => {
                    if (row.kind === "added") {
                      return (
                        <tr key={`added-${row.item.sortOrder}-${index}`} className="is-added">
                          <td>+ {t("finance.quotes.editor.versions.diffStatus.added")}</td>
                          <td>{row.item.quantity}</td>
                          <td>{row.item.title}</td>
                          <td>{formatCurrency(row.item.unitPrice, snapshot.currency, language)}</td>
                        </tr>
                      );
                    }
                    if (row.kind === "removed") {
                      return (
                        <tr key={`removed-${row.item.sortOrder}-${index}`} className="is-removed">
                          <td>− {t("finance.quotes.editor.versions.diffStatus.removed")}</td>
                          <td>{row.item.quantity}</td>
                          <td>{row.item.title}</td>
                          <td>{formatCurrency(row.item.unitPrice, snapshot.currency, language)}</td>
                        </tr>
                      );
                    }
                    if (row.kind === "changed") {
                      return (
                        <tr key={`changed-${row.before.sortOrder}-${index}`} className="is-changed">
                          <td>~ {t("finance.quotes.editor.versions.diffStatus.changed")}</td>
                          <td>
                            <div>{row.before.quantity}</div>
                            <div className="quote-version-changed-after">→ {row.after.quantity}</div>
                          </td>
                          <td>
                            <div>{row.before.title}</div>
                            <div className="quote-version-changed-after">→ {row.after.title}</div>
                          </td>
                          <td>
                            <div>
                              {formatCurrency(row.before.unitPrice, snapshot.currency, language)}
                            </div>
                            <div className="quote-version-changed-after">
                              → {formatCurrency(row.after.unitPrice, snapshot.currency, language)}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`unchanged-${row.item.sortOrder}-${index}`}>
                        <td>{t("finance.quotes.editor.versions.diffStatus.unchanged")}</td>
                        <td>{row.item.quantity}</td>
                        <td>{row.item.title}</td>
                        <td>{formatCurrency(row.item.unitPrice, snapshot.currency, language)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "diff" && !currentQuote ? (
          <p className="action-feedback action-feedback-info">
            {t("finance.quotes.editor.versions.diffOnlyOnDrafts")}
          </p>
        ) : null}

        {snapshot ? (
          <div className="quote-version-panel-actions">
            <button
              type="button"
              className="action-primary-button"
              disabled={restoreDisabled}
              onClick={() => setConfirmOpen(true)}
              data-tooltip={restoreDisabledReason ?? undefined}
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>
                {isRestoring
                  ? t("finance.quotes.editor.versions.restoring")
                  : t("finance.quotes.editor.versions.restoreButton")}
              </span>
            </button>
            {restoreDisabledReason ? (
              <small className="text-muted">{restoreDisabledReason}</small>
            ) : null}
          </div>
        ) : null}
      </SurfaceCard>

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t("finance.quotes.editor.versions.restoreConfirmTitle", { number: version.versionNumber })}
        body={t("finance.quotes.editor.versions.restoreConfirmBody", { number: version.versionNumber })}
        confirmLabel={t("finance.quotes.editor.versions.restoreConfirmYes")}
        cancelLabel={t("finance.quotes.editor.versions.restoreConfirmNo")}
        isSubmitting={isRestoring}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await onRestore();
          setConfirmOpen(false);
        }}
      />
    </>
  );
};
