import type { GlobalSearchGroup, GlobalSearchResult } from "@contracts";
import { Command, CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useDebouncedValue } from "@shared/hooks/useDebouncedValue";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { pushRecentEntityKey, readRecentEntityKeys } from "@shared/lib/recentEntities";
import { useWorkspace } from "@app/providers/WorkspaceProvider";

type GlobalSearchPaletteProps = {
  open: boolean;
  onClose: () => void;
};

const emptyGroups: GlobalSearchGroup[] = [];

export const GlobalSearchPalette = ({ open, onClose }: GlobalSearchPaletteProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { activeWorkspaceId } = useWorkspace();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<GlobalSearchGroup[]>(emptyGroups);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query.trim(), 100);

  const flattenedResults = useMemo(() => groups.flatMap((group) => group.results), [groups]);
  const resultIndexMap = useMemo(
    () =>
      new Map(
        flattenedResults.map((result, index) => [`${result.entityType}:${result.entityId}`, index]),
      ),
    [flattenedResults],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setGroups(emptyGroups);
      setError(null);
      setIsLoading(false);
      setActiveIndex(0);
      return;
    }

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    if (!open || !debouncedQuery) {
      setGroups(emptyGroups);
      setError(null);
      setIsLoading(false);
      setActiveIndex(0);
      return;
    }

    if (!window.bukowskiShell) {
      setGroups(emptyGroups);
      setError("Search bridge unavailable.");
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);

    window.bukowskiShell
      .searchGlobal({
        workspaceId: activeWorkspaceId,
        query: debouncedQuery,
        recentEntityKeys: readRecentEntityKeys(),
        limit: 20,
      })
      .then((nextGroups) => {
        if (isCancelled) {
          return;
        }

        setGroups(nextGroups);
        setError(null);
        setIsLoading(false);
        setActiveIndex(0);
      })
      .catch((nextError) => {
        if (isCancelled) {
          return;
        }

        setGroups(emptyGroups);
        setError(getUserFacingErrorMessage(nextError, "Unable to search right now."));
        setIsLoading(false);
        setActiveIndex(0);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspaceId, debouncedQuery, open]);

  useEffect(() => {
    if (!flattenedResults.length) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((currentIndex) => Math.min(currentIndex, flattenedResults.length - 1));
  }, [flattenedResults.length]);

  if (!open) {
    return null;
  }

  const activeResult = flattenedResults[activeIndex] ?? null;

  const selectResult = (result: GlobalSearchResult) => {
    pushRecentEntityKey(result.entityType, result.entityId);
    navigate(result.navigationPath);
    onClose();
  };

  return (
    <div
      aria-hidden={!open}
      className="command-palette-backdrop"
      onClick={() => onClose()}
      role="presentation"
    >
      <section
        aria-label={t("shell.search.ariaLabel")}
        className="command-palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }

          if (!flattenedResults.length) {
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((currentIndex) => (currentIndex + 1) % flattenedResults.length);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((currentIndex) => (currentIndex - 1 + flattenedResults.length) % flattenedResults.length);
            return;
          }

          if (event.key === "Enter" && activeResult) {
            event.preventDefault();
            selectResult(activeResult);
          }
        }}
      >
        <div className="command-palette-input-row">
          <div className="command-palette-search-shell">
            <Search aria-hidden size={15} />
            <input
              ref={inputRef}
              className="command-palette-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("shell.search.placeholder")}
              type="search"
              value={query}
            />
          </div>

          <button aria-label={t("shell.search.close")} className="surface-card-action" onClick={onClose} type="button">
            <X size={14} />
          </button>
        </div>

        <div className="command-palette-body">
          {!query.trim() ? (
            <div className="command-palette-empty">
              <Command size={16} />
              <span>{t("shell.search.emptyHint")}</span>
            </div>
          ) : null}

          {isLoading ? <div className="command-palette-empty">{t("shell.search.searching")}</div> : null}
          {error ? <div className="command-palette-empty">{error}</div> : null}
          {!isLoading && !error && query.trim() && !flattenedResults.length ? (
            <div className="command-palette-empty">{t("shell.search.noMatches", { query: query.trim() })}</div>
          ) : null}

          {!isLoading && !error && flattenedResults.length ? (
            <div className="command-palette-groups">
              {groups.map((group) => (
                <div key={group.entityType} className="command-palette-group">
                  <div className="command-palette-group-label">{group.label}</div>
                  <div className="command-palette-result-list">
                    {group.results.map((result) => {
                      const resultIndex = resultIndexMap.get(`${result.entityType}:${result.entityId}`) ?? 0;

                      return (
                        <button
                          key={`${result.entityType}:${result.entityId}`}
                          className={`command-palette-result${resultIndex === activeIndex ? " active" : ""}`}
                          onClick={() => selectResult(result)}
                          onMouseEnter={() => setActiveIndex(resultIndex)}
                          type="button"
                        >
                          <div className="identity-cell">
                            <span className="identity-title">{result.title}</span>
                            <span className="identity-meta">{result.subtitle}</span>
                          </div>
                          <div className="command-palette-result-meta">
                            {result.meta ? <span className="command-palette-meta-chip">{result.meta}</span> : null}
                            {result.recent ? <span className="command-palette-meta-chip">{t("shell.search.recent")}</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="command-palette-footer">
          <span>{t("shell.search.moveHint")}</span>
          <span>
            <CornerDownLeft size={12} /> {t("shell.search.openHint")}
          </span>
          <span>{t("shell.search.escToClose")}</span>
        </div>
      </section>
    </div>
  );
};
