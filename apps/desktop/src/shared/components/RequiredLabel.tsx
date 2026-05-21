import type { ReactNode } from "react";

type RequiredLabelProps = {
  children: ReactNode;
  className?: string;
};

export const RequiredLabel = ({ children, className = "" }: RequiredLabelProps) => (
  <span className={`required-field-label ${className}`.trim()}>
    <span>{children}</span>
    <span className="required-field-marker" aria-hidden="true">
      *
    </span>
    <span className="sr-only"> required</span>
  </span>
);

export default RequiredLabel;
