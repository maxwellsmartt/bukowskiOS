type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  body: string;
};

export const SectionHeader = ({ eyebrow, title, body }: SectionHeaderProps) => (
  <div className="section-header">
    <p className="section-header-eyebrow">{eyebrow}</p>
    <h2 className="section-header-title">{title}</h2>
    <p className="section-header-body">{body}</p>
  </div>
);
