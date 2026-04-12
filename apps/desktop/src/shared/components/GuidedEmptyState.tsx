type GuidedEmptyStateProps = {
  title: string;
  body: string;
  tips?: string[];
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  tone?: "default" | "subtle";
};

export const GuidedEmptyState = ({
  title,
  body,
  tips = [],
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  tone = "default",
}: GuidedEmptyStateProps) => (
  <div className={`guided-empty-state guided-empty-state-${tone}`}>
    <div className="guided-empty-state-copy">
      <span className="guided-empty-state-title">{title}</span>
      <p className="guided-empty-state-body">{body}</p>
    </div>

    {tips.length ? (
      <div className="guided-empty-state-tips">
        {tips.map((tip) => (
          <span key={tip} className="guided-empty-state-tip">
            {tip}
          </span>
        ))}
      </div>
    ) : null}

    {actionLabel || secondaryActionLabel ? (
      <div className="guided-empty-state-actions">
        {actionLabel && onAction ? (
          <button className="action-primary-button" onClick={onAction} type="button">
            {actionLabel}
          </button>
        ) : null}
        {secondaryActionLabel && onSecondaryAction ? (
          <button className="ghost-control" onClick={onSecondaryAction} type="button">
            {secondaryActionLabel}
          </button>
        ) : null}
      </div>
    ) : null}
  </div>
);
