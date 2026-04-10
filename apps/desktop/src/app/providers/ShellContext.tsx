import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AppInfo, CreateProjectInput, ProjectCardRow, ShellBootstrap, UpdateProjectInput } from "@contracts";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

type ShellContextValue = {
  appInfo: AppInfo | null;
  workspaceName: string;
  projectScope: string;
  syncLabel: string;
  projects: ProjectCardRow[];
  activeProjectId: string | null;
  activeProject: ProjectCardRow | null;
  projectsError: string | null;
  setActiveProjectId: (projectId: string | null) => void;
  refreshProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<void>;
  updateProject: (input: UpdateProjectInput) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
};

const ShellContext = createContext<ShellContextValue | null>(null);

type ShellContextProviderProps = {
  children: ReactNode;
};

export const ShellContextProvider = ({ children }: ShellContextProviderProps) => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [shellBootstrap, setShellBootstrap] = useState<ShellBootstrap | null>(null);
  const [projects, setProjects] = useState<ProjectCardRow[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(() => {
    return readStringPreference(uiPreferenceKeys.activeProjectId);
  });

  useEffect(() => {
    const load = async () => {
      if (!window.bukowskiApp || !window.bukowskiShell) {
        return;
      }

      try {
        const [nextAppInfo, nextShellBootstrap] = await Promise.all([
          window.bukowskiApp.getAppInfo(),
          window.bukowskiShell.getBootstrap(),
        ]);

        setAppInfo(nextAppInfo);
        setShellBootstrap(nextShellBootstrap);
      } catch {
        setAppInfo(null);
        setShellBootstrap(null);
      }
    };

    void load();
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!window.bukowskiProjects) {
      return;
    }

    try {
      const nextProjects = await window.bukowskiProjects.getList();

      setProjects(nextProjects);
      setProjectsError(null);
      setActiveProjectIdState((currentProjectId) => {
        if (currentProjectId && nextProjects.some((project) => project.id === currentProjectId)) {
          return currentProjectId;
        }

        return nextProjects[0]?.id ?? null;
      });
    } catch (error) {
      setProjects([]);
      setProjectsError(error instanceof Error ? error.message : "Project shell unavailable");
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.activeProjectId, activeProjectId);
  }, [activeProjectId]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const setActiveProjectId = (projectId: string | null) => {
    setActiveProjectIdState(projectId);
  };

  const createProject = async (input: CreateProjectInput) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.create(input);
    setProjects(nextProjects);
    setProjectsError(null);

    const createdProject =
      nextProjects.find((project) => project.code === input.code.trim().toUpperCase() && project.name === input.name.trim()) ?? null;

    setActiveProjectIdState(createdProject?.id ?? nextProjects[0]?.id ?? null);
  };

  const updateProject = async (input: UpdateProjectInput) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.update(input);
    setProjects(nextProjects);
    setProjectsError(null);
    setActiveProjectIdState(input.projectId);
  };

  const deleteProject = async (projectId: string) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.remove({ projectId });
    setProjects(nextProjects);
    setProjectsError(null);
    setActiveProjectIdState((currentProjectId) =>
      currentProjectId === projectId ? nextProjects[0]?.id ?? null : currentProjectId,
    );
  };

  const value = useMemo<ShellContextValue>(
    () => ({
      appInfo,
      workspaceName: shellBootstrap?.workspaceName ?? "Metadata Cine",
      projectScope: activeProject ? `Global / ${activeProject.name}` : shellBootstrap?.projectScope ?? "Global",
      syncLabel: shellBootstrap?.syncLabel ?? "Local-first",
      projects,
      activeProjectId,
      activeProject,
      projectsError,
      setActiveProjectId,
      refreshProjects,
      createProject,
      updateProject,
      deleteProject,
    }),
    [activeProject, activeProjectId, appInfo, projects, projectsError, refreshProjects, shellBootstrap],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
};

export const useShellContext = () => {
  const value = useContext(ShellContext);

  if (!value) {
    throw new Error("useShellContext must be used within ShellContextProvider");
  }

  return value;
};
