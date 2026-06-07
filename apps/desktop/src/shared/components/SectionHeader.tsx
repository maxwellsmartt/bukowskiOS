type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  body?: string;
  contextLabel?: string;
  titleTone?: "default" | "accent";
  /** Tighter vertical rhythm for dense views. */
  compact?: boolean;
};

export const SectionHeader = ({
  eyebrow,
  title,
  body,
  contextLabel,
  titleTone = "default",
  compact = false,
}: SectionHeaderProps) => (
  <div className={`section-header${compact ? " section-header-compact" : ""}`}>
    {eyebrow ? <p className="section-header-eyebrow">{eyebrow}</p> : null}
    <div className="section-header-title-row">
      <h1 className={`section-header-title section-header-title-${titleTone}`}>{title}</h1>
      {contextLabel ? <span className="section-header-context-pill">{contextLabel}</span> : null}
    </div>
    {body ? <p className="section-header-body">{body}</p> : null}
  </div>
);
