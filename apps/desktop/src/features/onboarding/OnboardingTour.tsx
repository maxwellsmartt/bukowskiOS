import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const tourSteps: OnboardingStep[] = [
  {
    icon: <Compass size={28} />,
    title: "Welcome to your workspace",
    body: "A workspace is your team's universe — every project, asset, incident and finance entry lives inside one. You can switch workspaces from the top-left dropdown.",
  },
  {
    icon: <FolderKanban size={28} />,
    title: "Create your first project",
    body: "Projects group everything for a single shoot or production: units, crew, assigned gear, incidents and budget. Open Projects to start one.",
    cta: { label: "Open Projects", to: "/projects" },
  },
  {
    icon: <Box size={28} />,
    title: "Add gear to your catalog",
    body: "Assets are individual pieces of equipment. Add them one by one or import a CSV. You can attach photos, print QR labels and track every movement.",
    cta: { label: "Open Assets", to: "/assets" },
  },
  {
    icon: <Send size={28} />,
    title: "Invite your team",
    body: "Bring your crew, finance lead and operators in. Each person gets a role that controls what they can see and do.",
    cta: { label: "Invite team", to: "/settings/workspace" },
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
  const navigate = useNavigate();
  const { activeWorkspaceId, activeWorkspaceName, isWorkspaceReady } = useWorkspace();
  const [stepIndex, setStepIndex] = useState(0);
  const [forceOpen, setForceOpen] = useState(false);
  const [completedWorkspaces, setCompletedWorkspaces] = useState(() => readCompletedWorkspaces());

  const isCompleted = useMemo(
    () => completedWorkspaces.includes(activeWorkspaceId),
    [activeWorkspaceId, completedWorkspaces],
  );

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
            Tour for {activeWorkspaceName || "this workspace"} · Step {stepIndex + 1} of {tourSteps.length}
          </span>
          <button aria-label="Skip onboarding" className="onboarding-close" onClick={handleClose} type="button">
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

        <div className="onboarding-progress" role="tablist" aria-label="Tour steps">
          {tourSteps.map((tourStep, index) => (
            <button
              key={tourStep.title}
              aria-current={index === stepIndex ? "step" : undefined}
              aria-label={`Step ${index + 1}: ${tourStep.title}`}
              className={`onboarding-progress-dot${index === stepIndex ? " is-active" : index < stepIndex ? " is-done" : ""}`}
              onClick={() => setStepIndex(index)}
              type="button"
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="ghost-control" onClick={handleClose} type="button">
            Skip tour
          </button>

          <div className="onboarding-actions-right">
            {!isFirst ? (
              <button className="ghost-control" onClick={handleBack} type="button">
                <ArrowLeft size={14} />
                <span>Back</span>
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
                  <Check size={14} /> <span>Done</span>
                </>
              ) : (
                <>
                  <span>Next</span> <ArrowRight size={14} />
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
