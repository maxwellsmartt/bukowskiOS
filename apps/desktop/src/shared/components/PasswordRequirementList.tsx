import { Check, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getPasswordRequirementStatus, passwordPolicy } from "@shared/lib/passwordPolicy";

type PasswordRequirementListProps = {
  password: string;
  compact?: boolean;
};

export const PasswordRequirementList = ({ password, compact = false }: PasswordRequirementListProps) => {
  const { t } = useTranslation();
  const requirements = getPasswordRequirementStatus(password);

  return (
    <div className={`password-requirements${compact ? " is-compact" : ""}`} aria-live="polite">
      <span className="password-requirements-title">{t("auth.passwordPolicy.title")}</span>
      <div className="password-requirements-grid">
        {requirements.map((requirement) => (
          <span
            className={`password-requirement${requirement.met ? " is-met" : ""}`}
            key={requirement.key}
          >
            {requirement.met ? <Check size={12} /> : <Circle size={10} />}
            <span>
              {t(`auth.passwordPolicy.requirements.${requirement.key}`, {
                count: passwordPolicy.minLength,
              })}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
};
