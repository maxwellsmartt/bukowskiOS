import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Box, Check, Compass, FolderKanban, Send, X } from "lucide-react";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { readJsonPreference, uiPreferenceKeys, writeJsonPreference } from "@shared/lib/preferences";

type OnboardingStep = {
  icon: ReactNode;
  title: string;
  body: string;
  cta?: { label: string; to: string };
};

const buildTourSteps = (t: TFunction): OnboardingStep[] => [
  {
    icon: <Compass size={28} />,
    title: t("onboarding.tour.steps.workspace.title"),
    body: t("onboarding.tour.steps.workspace.body"),
  },
  {
    icon: <FolderKanban size={28} />,
    title: t("onboarding.tour.steps.projects.title"),
    body: t("onboarding.tour.steps.projects.body"),
    cta: { label: t("onboarding.tour.steps.projects.cta"), to: "/projects" },
  },
  {
    icon: <Box size={28} />,
    title: t("onboarding.tour.steps.assets.title"),
    body: t("onboarding.tour.steps.assets.body"),
    cta: { label: t("onboarding.tour.steps.assets.cta"), to: "/assets" },
  },
  {
    icon: <Send size={28} />,
    title: t("onboarding.tour.steps.team.title"),
    body: t("onboarding.tour.steps.team.body"),
    cta: { label: t("onboarding.tour.steps.team.cta"), to: "/settings/workspace" },
  },
];

const readCompletedWorkspaces = () =>
  readJsonPreference<string[]>(uiPreferenceKeys.onboardingTourCompletedWorkspaces, []);

const markTourCompleted = (workspaceId: string) => {
  if (!workspaceId) {
    return;
  }
  const current = new Set(readCompletedWorkspaces());
  current.add(workspaceId);
  writeJsonPreference(uiPreferenceKeys.onboardingTourCompletedWorkspaces, Array.from(current));
};

export const OnboardingTour = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWorkspaceId, activeWorkspaceName, isWorkspaceReady } = useWorkspace();
  const [stepIndex, setStepIndex] = useState(0);
  const [forceOpen, setForceOpen] = useState(false);
  const [completedWorkspaces, setCompletedWorkspaces] = useState(() => readCompletedWorkspaces());

  const isCompleted = useMemo(
    () => completedWorkspaces.includes(activeWorkspaceId),
    [activeWorkspaceId, completedWorkspaces],
  );
  const tourSteps = useMemo(() => buildTourSteps(t), [t]);

  useEffect(() => {
    setCompletedWorkspaces(readCompletedWorkspaces());
    setStepIndex(0);
    setForceOpen(false);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!isWorkspaceReady) {
      return;
    }

    const handler = () => {
      setStepIndex(0);
      setForceOpen(true);
    };
    window.addEventListener("bukowski:open-onboarding", handler);
    return () => {
      window.removeEventListener("bukowski:open-onboarding", handler);
    };
  }, [isWorkspaceReady]);

  useEffect(() => {
    if (!isWorkspaceReady || isCompleted || forceOpen) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        markTourCompleted(activeWorkspaceId);
        setForceOpen(false);
        // Force a re-render via state bump
        setStepIndex((current) => current);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [activeWorkspaceId, forceOpen, isCompleted, isWorkspaceReady]);

  if (!isWorkspaceReady) {
    return null;
  }

  if (isCompleted && !forceOpen) {
    return null;
  }

  const step = tourSteps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === tourSteps.length - 1;

  const handleClose = () => {
    markTourCompleted(activeWorkspaceId);
    setCompletedWorkspaces(readCompletedWorkspaces());
    setForceOpen(false);
  };

  const handleNext = () => {
    if (isLast) {
      handleClose();
      window.dispatchEvent(new CustomEvent("bukowski:help-pulse"));
      return;
    }
    setStepIndex((current) => Math.min(current + 1, tourSteps.length - 1));
  };

  const handleBack = () => {
    setStepIndex((current) => Math.max(current - 1, 0));
  };

  const handleCtaClick = () => {
    if (!step.cta) {
      return;
    }
    handleClose();
    navigate(step.cta.to);
  };

  return (
    <div aria-modal="true" className="onboarding-backdrop" role="dialog">
      <div className="onboarding-card">
        <div className="onboarding-card-header">
          <span className="onboarding-eyebrow">
            {t("onboarding.tour.eyebrow", {
              workspace: activeWorkspaceName || t("onboarding.tour.thisWorkspace"),
              current: stepIndex + 1,
              total: tourSteps.length,
            })}
          </span>
          <button aria-label={t("onboarding.tour.skipOnboarding")} className="onboarding-close" onClick={handleClose} type="button">
            <X size={14} />
          </button>
        </div>

        <div className="onboarding-illustration" aria-hidden="true">
          {step.icon}
        </div>

        <strong className="onboarding-title">{step.title}</strong>
        <p className="onboarding-body">{step.body}</p>

        <div className="onboarding-progress-bar" aria-hidden="true">
          <span
            className="onboarding-progress-bar-fill"
            style={{ width: `${((stepIndex + 1) / tourSteps.length) * 100}%` }}
          />
        </div>

        <div className="onboarding-progress" role="tablist" aria-label={t("onboarding.tour.stepsAria")}>
          {tourSteps.map((tourStep, index) => (
            <button
              key={tourStep.title}
              aria-current={index === stepIndex ? "step" : undefined}
              aria-label={t("onboarding.tour.stepAria", { index: index + 1, title: tourStep.title })}
              className={`onboarding-progress-dot${index === stepIndex ? " is-active" : index < stepIndex ? " is-done" : ""}`}
              onClick={() => setStepIndex(index)}
              type="button"
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="ghost-control" onClick={handleClose} type="button">
            {t("onboarding.tour.skipTour")}
          </button>

          <div className="onboarding-actions-right">
            {!isFirst ? (
              <button className="ghost-control" onClick={handleBack} type="button">
                <ArrowLeft size={14} />
                <span>{t("onboarding.tour.back")}</span>
              </button>
            ) : null}
            {step.cta ? (
              <button className="ghost-control" onClick={handleCtaClick} type="button">
                {step.cta.label}
              </button>
            ) : null}
            <button className="action-primary-button" onClick={handleNext} type="button">
              {isLast ? (
                <>
                  <Check size={14} /> <span>{t("onboarding.tour.done")}</span>
                </>
              ) : (
                <>
                  <span>{t("onboarding.tour.next")}</span> <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const triggerOnboardingTour = () => {
  window.dispatchEvent(new CustomEvent("bukowski:open-onboarding"));
};
