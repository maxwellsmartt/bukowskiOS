import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useQuoteVersions } from "./useQuoteData";

type QuoteVersionsStripProps = {
  /** The quote whose versions we render. */
  quoteId: string;
  workspaceId: string;
  /** Visible label for the strip header. e.g. the quote number. */
  quoteLabel: string;
};

/**
 * Compact horizontal dot timeline rendered under a selected row in the
 * Quotes list. Each dot is a button that deep-links to the editor at
 * that version (`/finance/quotes/:id?version=N`). Ascending order
 * (oldest left → newest right) so the timeline reads left-to-right.
 */
export const QuoteVersionsStrip = ({ quoteId, workspaceId, quoteLabel }: QuoteVersionsStripProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useQuoteVersions(workspaceId, quoteId);

  // listQuoteVersions returns DESC (newest first); the strip reads chronologically.
  const ordered = [...data].sort((a, b) => a.versionNumber - b.versionNumber);

  return (
    <div className="quote-versions-strip">
      <div className="quote-versions-strip-header">
        <span className="quote-versions-strip-title">
          {t("finance.quotes.list.versionsStripTitle", { number: quoteLabel })}
        </span>
        {!isLoading && data.length > 0 ? (
          <span className="quote-versions-strip-count">
            {t("finance.quotes.editor.versionCount", { count: data.length })}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="quote-versions-strip-empty">{t("finance.quotes.list.versionsStripLoading")}</p>
      ) : ordered.length === 0 ? (
        <p className="quote-versions-strip-empty">{t("finance.quotes.list.versionsStripEmpty")}</p>
      ) : (
        <div className="quote-versions-strip-track" role="list">
          {ordered.map((version) => (
            <button
              key={version.id}
              type="button"
              role="listitem"
              className="quote-versions-strip-node"
              aria-label={t("finance.quotes.editor.versions.openTooltip", {
                number: version.versionNumber,
              })}
              data-tooltip={
                version.changeSummary
                  ? `v${version.versionNumber} · ${version.changeSummary}`
                  : `v${version.versionNumber}`
              }
              onClick={() => navigate(`/finance/quotes/${quoteId}?version=${version.versionNumber}`)}
            >
              <span className="quote-versions-strip-dot" aria-hidden="true" />
              <span className="quote-versions-strip-label">v{version.versionNumber}</span>
              <span className="quote-versions-strip-date">
                {version.createdAt.slice(0, 10)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
