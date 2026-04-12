type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  body?: string;
  contextLabel?: string;
  titleTone?: "default" | "accent";
};

export const SectionHeader = ({ eyebrow, title, body, contextLabel, titleTone = "default" }: SectionHeaderProps) => (
  <div className="section-header">
    {eyebrow ? <p className="section-header-eyebrow">{eyebrow}</p> : null}
    <div className="section-header-title-row">
      <h2 className={`section-header-title section-header-title-${titleTone}`}>{title}</h2>
      {contextLabel ? <span className="section-header-context-pill">{contextLabel}</span> : null}
    </div>
    {body ? <p className="section-header-body">{body}</p> : null}
  </div>
);
