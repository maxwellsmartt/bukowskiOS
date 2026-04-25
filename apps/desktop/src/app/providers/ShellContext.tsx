import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type {
  AppInfo,
  ArchiveProjectInput,
  CreateProjectBlueprintInput,
  CreateProjectInput,
  ProjectCardRow,
  ProjectDeletePreview,
  ShellBootstrap,
  UnarchiveProjectInput,
  UpdateProjectInput,
} from "@contracts";
import type { ProjectRouteSection, ScopeMode } from "@app/routing/route-meta";
import { resolveActiveRoute, resolveRememberedGlobalPath } from "@app/routing/route-meta";
import { readJsonPreference, readStringPreference, uiPreferenceKeys, writeJsonPreference, writePreference } from "@shared/lib/preferences";
import { useWorkspace } from "./WorkspaceProvider";

type ShellContextValue = {
  appInfo: AppInfo | null;
  activeWorkspaceId: string;
  workspaceName: string;
  scopeMode: ScopeMode;
  scopeChipLabel: string | null;
  projects: ProjectCardRow[];
  isScopeReady: boolean;
  activeProjectId: string | null;
  activeProject: ProjectCardRow | null;
  activeProjectRouteSection: ProjectRouteSection | null;
  projectsError: string | null;
  showArchivedProjects: boolean;
  setShowArchivedProjects: (show: boolean) => void;
  projectDataVersion: number;
  setActiveProjectId: (projectId: string | null) => void;
  openProject: (projectId: string, section?: ProjectRouteSection) => void;
  refreshProjects: () => Promise<void>;
  createProject: (input: Omit<CreateProjectInput, "workspaceId">) => Promise<void>;
  createProjectBlueprint: (input: Omit<CreateProjectBlueprintInput, "workspaceId">) => Promise<ProjectCardRow | null>;
  updateProject: (input: UpdateProjectInput) => Promise<void>;
  getProjectDeletePreview: (projectId: string) => Promise<ProjectDeletePreview>;
  archiveProject: (input: ArchiveProjectInput) => Promise<void>;
  unarchiveProject: (input: UnarchiveProjectInput) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
};

const ShellContext = createContext<ShellContextValue | null>(null);

type ShellContextProviderProps = {
  children: ReactNode;
};

const resolveProjectSectionPreference = () => {
  const section = readStringPreference(uiPreferenceKeys.lastProjectRouteSection, "info");

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

  return "info";
};

export const ShellContextProvider = ({ children }: ShellContextProviderProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeWorkspaceId, activeWorkspaceName, isWorkspaceReady } = useWorkspace();
  const activeRoute = useMemo(() => resolveActiveRoute(location.pathname), [location.pathname]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [shellBootstrap, setShellBootstrap] = useState<ShellBootstrap | null>(null);
  const [projects, setProjects] = useState<ProjectCardRow[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsHydrated, setProjectsHydrated] = useState(false);
  const [projectDataVersion, setProjectDataVersion] = useState(0);
  const [showArchivedProjects, setShowArchivedProjects] = useState(() =>
    readJsonPreference(uiPreferenceKeys.shellProjectsShowArchived, false),
  );
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
    if (!isWorkspaceReady) {
      setProjects([]);
      setProjectsError(null);
      setProjectsHydrated(false);
      return;
    }

    if (!window.bukowskiProjects) {
      return;
    }

    try {
      const nextProjects = await window.bukowskiProjects.getList({
        workspaceId: activeWorkspaceId,
        search: "",
        sortBy: "name",
        sortDirection: "asc",
        includeArchived: showArchivedProjects,
      });

      setProjects(nextProjects);
      setProjectsError(null);
      setProjectsHydrated(true);
      setRememberedProjectId((currentProjectId) => {
        if (currentProjectId && nextProjects.some((project) => project.id === currentProjectId)) {
          return currentProjectId;
        }

        return nextProjects[0]?.id ?? null;
      });
    } catch (error) {
      setProjects([]);
      setProjectsError(error instanceof Error ? error.message : "Project shell unavailable");
      setProjectsHydrated(true);
    }
  }, [activeWorkspaceId, isWorkspaceReady, showArchivedProjects]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.activeProjectId, rememberedProjectId);
  }, [rememberedProjectId]);

  useEffect(() => {
    writeJsonPreference(uiPreferenceKeys.shellProjectsShowArchived, showArchivedProjects);
  }, [showArchivedProjects]);

  const activeProjectId = activeRoute.scopeMode === "project" ? activeRoute.projectId : rememberedProjectId;

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const isScopeReady = useMemo(() => {
    if (activeRoute.scopeMode !== "project") {
      return true;
    }

    if (!projectsHydrated || !activeRoute.projectId) {
      return false;
    }

    return projects.some((project) => project.id === activeRoute.projectId);
  }, [activeRoute.projectId, activeRoute.scopeMode, projects, projectsHydrated]);

  useEffect(() => {
    if (activeRoute.scopeMode !== "project" || !projectsHydrated || !activeRoute.projectId) {
      return;
    }

    const projectStillExists = projects.some((project) => project.id === activeRoute.projectId);

    if (!projectStillExists) {
      navigate(resolveRememberedGlobalPath(), { replace: true });
    }
  }, [activeRoute.projectId, activeRoute.scopeMode, navigate, projects, projectsHydrated]);

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

  const createProject = async (input: Omit<CreateProjectInput, "workspaceId">) => {
    if (!isWorkspaceReady) {
      throw new Error("Wait for the workspace to finish loading before creating a project.");
    }

    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.create({ ...input, workspaceId: activeWorkspaceId });
    setProjects(nextProjects);
    setProjectsError(null);

    const createdProject =
      nextProjects.find((project) => project.code === input.code.trim().toUpperCase() && project.name === input.name.trim()) ?? null;

    setRememberedProjectId(createdProject?.id ?? nextProjects[0]?.id ?? null);
    await refreshProjects();
    setProjectDataVersion((current) => current + 1);
  };

  const createProjectBlueprint = async (input: Omit<CreateProjectBlueprintInput, "workspaceId">) => {
    if (!isWorkspaceReady) {
      throw new Error("Wait for the workspace to finish loading before creating a project.");
    }

    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextInput = { ...input, workspaceId: activeWorkspaceId };
    const nextProjects = await window.bukowskiProjects.createBlueprint(nextInput);
    setProjects(nextProjects);
    setProjectsError(null);

    const requestedCode = nextInput.generalInfo.code?.trim().toUpperCase();
    const requestedName = nextInput.generalInfo.name.trim();
    const createdProject =
      nextProjects.find(
        (project) =>
          project.name === requestedName && (!requestedCode || project.code === requestedCode),
      ) ?? null;

    setRememberedProjectId(createdProject?.id ?? nextProjects[0]?.id ?? null);
    await refreshProjects();
    setProjectDataVersion((current) => current + 1);
    return createdProject;
  };

  const updateProject = async (input: UpdateProjectInput) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.update(input);
    setProjects(nextProjects);
    setProjectsError(null);
    setRememberedProjectId(input.projectId);
    await refreshProjects();
    setProjectDataVersion((current) => current + 1);
  };

  const getProjectDeletePreview = async (projectId: string) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    return window.bukowskiProjects.getDeletePreview(projectId);
  };

  const archiveProject = async (input: ArchiveProjectInput) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    await window.bukowskiProjects.archive(input);
    await refreshProjects();
    setProjectsError(null);
    setProjectDataVersion((current) => current + 1);

    if (activeRoute.scopeMode === "project" && activeRoute.projectId === input.projectId) {
      navigate(resolveRememberedGlobalPath(), { replace: true });
    }
  };

  const unarchiveProject = async (input: UnarchiveProjectInput) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    await window.bukowskiProjects.unarchive(input);
    await refreshProjects();
    setProjectsError(null);
    setRememberedProjectId(input.projectId);
    setProjectDataVersion((current) => current + 1);
  };

  const deleteProject = async (projectId: string) => {
    if (!window.bukowskiProjects) {
      throw new Error("Projects bridge unavailable");
    }

    const nextProjects = await window.bukowskiProjects.remove({ projectId, confirmedWithBackup: true });
    setProjects(nextProjects);
    setProjectsError(null);
    setRememberedProjectId((currentProjectId) =>
      currentProjectId === projectId ? nextProjects[0]?.id ?? null : currentProjectId,
    );
    await refreshProjects();
    setProjectDataVersion((current) => current + 1);

    if (activeRoute.scopeMode === "project" && activeRoute.projectId === projectId) {
      navigate(resolveRememberedGlobalPath(), { replace: true });
    }
  };

  const scopeChipLabel =
    activeRoute.scopeMode === "project"
      ? activeProject
        ? `${activeProject.code} · ${activeProject.name}`
        : "Project"
      : null;

  const value = useMemo<ShellContextValue>(
    () => ({
      appInfo,
      activeWorkspaceId,
      workspaceName: activeWorkspaceName || shellBootstrap?.workspaceName || "Metadata Cine",
      scopeMode: activeRoute.scopeMode,
      scopeChipLabel,
      projects,
      isScopeReady,
      activeProjectId,
      activeProject,
      activeProjectRouteSection: activeRoute.scopeMode === "project" ? activeRoute.projectSection ?? null : null,
      projectsError,
      showArchivedProjects,
      setShowArchivedProjects,
      projectDataVersion,
      setActiveProjectId,
      openProject,
      refreshProjects,
      createProject,
      createProjectBlueprint,
      updateProject,
      getProjectDeletePreview,
      archiveProject,
      unarchiveProject,
      deleteProject,
    }),
    [
      activeProject,
      activeProjectId,
      activeRoute.projectSection,
      activeRoute.scopeMode,
      activeWorkspaceId,
      activeWorkspaceName,
      appInfo,
      createProject,
      archiveProject,
      deleteProject,
      getProjectDeletePreview,
      isScopeReady,
      openProject,
      projects,
      projectsError,
      projectDataVersion,
      refreshProjects,
      createProjectBlueprint,
      scopeChipLabel,
      shellBootstrap,
      showArchivedProjects,
      unarchiveProject,
      updateProject,
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
