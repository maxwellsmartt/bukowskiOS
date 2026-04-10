import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  className?: string;
  wrapperClassName?: string;
};

export const SelectField = ({ children, className = "", wrapperClassName = "", ...props }: SelectFieldProps) => (
  <div className={`select-field-shell ${wrapperClassName}`.trim()}>
    <select {...props} className={`action-field-control select-field-control ${className}`.trim()}>
      {children}
    </select>
    <ChevronDown aria-hidden className="select-field-chevron" size={14} />
  </div>
);
