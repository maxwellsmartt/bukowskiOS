import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { AppInfo, CreateProjectInput, ProjectCardRow, ShellBootstrap, UpdateProjectInput } from "@contracts";
import type { ProjectRouteSection, ScopeMode } from "@app/routing/route-meta";
import { resolveActiveRoute, resolveRememberedGlobalPath } from "@app/routing/route-meta";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

type ShellContextValue = {
  appInfo: AppInfo | null;
  workspaceName: string;
  scopeMode: ScopeMode;
  scopeChipLabel: string;
  syncLabel: string;
  projects: ProjectCardRow[];
  activeProjectId: string | null;
  activeProject: ProjectCardRow | null;
  activeProjectRouteSection: ProjectRouteSection | null;
  projectsError: string | null;
  setActiveProjectId: (projectId: string | null) => void;
  openProject: (projectId: string, section?: ProjectRouteSection) => void;
  refreshProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<void>;
  updateProject: (input: UpdateProjectInput) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
};

const ShellContext = createContext<ShellContextValue | null>(null);

type ShellContextProviderProps = {
  children: ReactNode;
};

const resolveProjectSectionPreference = () => {
  const section = readStringPreference(uiPreferenceKeys.lastProjectRouteSection, "overview");

  if (
    section === "overview" ||
    section === "assets" ||
    section === "packing" ||
    section === "incidents" ||
    section === "budget" ||
    section === "info"
  ) {
    return section;
  }

  return "overview";
};

export const ShellContextProvider = ({ children }: ShellContextProviderProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoute = useMemo(() => resolveActiveRoute(location.pathname), [location.pathname]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [shellBootstrap, setShellBootstrap] = useState<ShellBootstrap | null>(null);
  const [projects, setProjects] = useState<ProjectCardRow[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [rememberedProjectId, setRememberedProjectId] = useState<string | null>(() =>
    readStringPreference(uiPreferenceKeys.activeProjectId),
  );

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

  useEffect(() => {
    if (activeRoute.scopeMode === "project" && activeRoute.projectId) {
      setRememberedProjectId((currentProjectId) => (currentProjectId === activeRoute.projectId ? currentProjectId : activeRoute.projectId));
    }
  }, [activeRoute.projectId, activeRoute.scopeMode]);

  const refreshProjects = useCallback(async () => {
    if (!window.bukowskiProjects) {
      return;
    }

    try {
      const nextProjects = await window.bukowskiProjects.getList();

      setProjects(nextProjects);
      setProjectsError(null);
      setRememberedProjectId((currentProjectId) => {
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
    writePreference(uiPreferenceKeys.activeProjectId, rememberedProjectId);
  }, [rememberedProjectId]);

  const activeProjectId = activeRoute.scopeMode === "project" ? activeRoute.projectId : rememberedProjectId;

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  useEffect(() => {
    if (activeRoute.scopeMode !== "project" || !activeRoute.projectId || !projects.length) {
      return;
    }

    const projectStillExists = projects.some((project) => project.id === activeRoute.projectId);

    if (!projectStillExists) {
      navigate(resolveRememberedGlobalPath(), { replace: true });
    }
  }, [activeRoute.projectId, activeRoute.scopeMode, navigate, projects]);

  const setActiveProjectId = (projectId: string | null) => {
    setRememberedProjectId(projectId);
  };

  const openProject = useCallback(
    (projectId: string, section?: ProjectRouteSection) => {
      const targetSection = section ?? resolveProjectSectionPreference();

      setRememberedProjectId(projectId);
      navigate(`/projects/${projectId}/${targetSection}`);
    },
    [navigate],
  );

  const createProject = async (input: CreateProjectInput) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.create(input);
    setProjects(nextProjects);
    setProjectsError(null);

    const createdProject =
      nextProjects.find((project) => project.code === input.code.trim().toUpperCase() && project.name === input.name.trim()) ?? null;

    setRememberedProjectId(createdProject?.id ?? nextProjects[0]?.id ?? null);
  };

  const updateProject = async (input: UpdateProjectInput) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.update(input);
    setProjects(nextProjects);
    setProjectsError(null);
    setRememberedProjectId(input.projectId);
  };

  const deleteProject = async (projectId: string) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.remove({ projectId });
    setProjects(nextProjects);
    setProjectsError(null);
    setRememberedProjectId((currentProjectId) =>
      currentProjectId === projectId ? nextProjects[0]?.id ?? null : currentProjectId,
    );

    if (activeRoute.scopeMode === "project" && activeRoute.projectId === projectId) {
      navigate(resolveRememberedGlobalPath(), { replace: true });
    }
  };

  const scopeChipLabel =
    activeRoute.scopeMode === "project"
      ? activeProject
        ? `Project · ${activeProject.code} / ${activeProject.name}`
        : "Project mode"
      : "Global workspace";

  const value = useMemo<ShellContextValue>(
    () => ({
      appInfo,
      workspaceName: shellBootstrap?.workspaceName ?? "Metadata Cine",
      scopeMode: activeRoute.scopeMode,
      scopeChipLabel,
      syncLabel: shellBootstrap?.syncLabel ?? "Local-first",
      projects,
      activeProjectId,
      activeProject,
      activeProjectRouteSection: activeRoute.scopeMode === "project" ? activeRoute.projectSection ?? null : null,
      projectsError,
      setActiveProjectId,
      openProject,
      refreshProjects,
      createProject,
      updateProject,
      deleteProject,
    }),
    [
      activeProject,
      activeProjectId,
      activeRoute.projectSection,
      activeRoute.scopeMode,
      appInfo,
      openProject,
      projects,
      projectsError,
      refreshProjects,
      scopeChipLabel,
      shellBootstrap,
    ],
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
