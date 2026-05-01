import { HelpCircle } from "lucide-react";

type HelpHintProps = {
  body: string;
  label?: string;
  size?: number;
};

export const HelpHint = ({ body, label, size = 13 }: HelpHintProps) => (
  <button
    aria-label={label ?? "Show help"}
    className="help-hint"
    data-tooltip={body}
    onClick={(event) => event.preventDefault()}
    type="button"
  >
    <HelpCircle aria-hidden="true" size={size} />
  </button>
);
