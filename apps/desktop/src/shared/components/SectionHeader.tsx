type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  body: string;
  contextLabel?: string;
};

export const SectionHeader = ({ eyebrow, title, body, contextLabel }: SectionHeaderProps) => (
  <div className="section-header">
    <p className="section-header-eyebrow">{eyebrow}</p>
    <div className="section-header-title-row">
      <h2 className="section-header-title">{title}</h2>
      {contextLabel ? <span className="section-header-context-pill">{contextLabel}</span> : null}
    </div>
    <p className="section-header-body">{body}</p>
  </div>
);
