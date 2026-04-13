import {
  Bot,
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  FolderCog,
  Info,
  PackageSearch,
  ScrollText,
  Settings,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ProjectRouteSection } from "@app/routing/route-meta";

export type NavItem = {
  label: string;
  path: string;
  icon?: LucideIcon;
  tone?: "default" | "accent";
};

export const primaryNav: NavItem[] = [
  { label: "Assets", path: "/assets/overview", icon: Boxes },
  { label: "Finance", path: "/finance", icon: BriefcaseBusiness },
  { label: "Agents", path: "/agents/mission-control", icon: Bot },
];

export const assetsSubnav: NavItem[] = [
  { label: "Overview", path: "/assets/overview", icon: BarChart3 },
  { label: "Assets", path: "/assets", icon: PackageSearch },
  { label: "Packing Slips", path: "/packing-slips", icon: ScrollText },
  { label: "Projects", path: "/projects", icon: Building2 },
  { label: "Incidents", path: "/incidents", icon: ClipboardList },
  { label: "Manage Catalog", path: "/catalog", icon: FolderCog, tone: "accent" },
];

export const financeSubnav: NavItem[] = [
  { label: "Overview", path: "/finance", icon: BarChart3 },
  { label: "Cost Links", path: "/finance/cost-links", icon: ClipboardList },
  { label: "Entries", path: "/finance/entries", icon: ScrollText },
];

export const agentsSubnav: NavItem[] = [
  { label: "Mission Control", path: "/agents/mission-control", icon: Bot },
  { label: "Agents", path: "/agents", icon: Boxes },
  { label: "Runs", path: "/agents/runs", icon: ScrollText },
  { label: "Models", path: "/agents/models", icon: FolderCog },
  { label: "Connectors", path: "/agents/connectors", icon: ClipboardList },
];

const projectSectionMeta: Record<ProjectRouteSection, Omit<NavItem, "path">> = {
  overview: { label: "Overview", icon: BarChart3 },
  assets: { label: "Assets", icon: PackageSearch },
  packing: { label: "Packing", icon: ScrollText },
  incidents: { label: "Incidents", icon: ClipboardList },
  budget: { label: "Budget", icon: Wallet },
  info: { label: "Info", icon: Info },
};

export const buildProjectSubnav = (projectId: string): NavItem[] =>
  (Object.entries(projectSectionMeta) as Array<[ProjectRouteSection, Omit<NavItem, "path">]>).map(([section, item]) => ({
    ...item,
    path: `/projects/${projectId}/${section}`,
  }));

export const utilityNav: NavItem[] = [{ label: "Settings", path: "/settings", icon: Settings }];
