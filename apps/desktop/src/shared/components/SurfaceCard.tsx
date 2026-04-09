import type { ReactNode } from "react";

type SurfaceCardProps = {
  title?: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

export const SurfaceCard = ({ title, subtitle, aside, children, className = "" }: SurfaceCardProps) => (
  <section className={`surface-card ${className}`.trim()}>
    {title || subtitle || aside ? (
      <header className="surface-card-header">
        <div>
          {title ? <h2 className="surface-card-title">{title}</h2> : null}
          {subtitle ? <p className="surface-card-subtitle">{subtitle}</p> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </header>
    ) : null}
    {children}
  </section>
);
