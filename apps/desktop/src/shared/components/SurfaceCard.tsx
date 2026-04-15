import type { ReactNode } from "react";

type SurfaceCardProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  titleLevel?: "h2" | "h3";
};

export const SurfaceCard = ({ title, subtitle, aside, children, className = "", titleLevel = "h2" }: SurfaceCardProps) => {
  const TitleTag = titleLevel;

  return (
    <section className={`surface-card ${className}`.trim()}>
      {title || subtitle || aside ? (
        <header className="surface-card-header">
          <div>
            {title ? <TitleTag className="surface-card-title">{title}</TitleTag> : null}
            {subtitle ? <p className="surface-card-subtitle">{subtitle}</p> : null}
          </div>
          {aside ? <div>{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
};
