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
  { label: "Projects", path: "/projects", icon: Building2 },
  { label: "Assets", path: "/assets/overview", icon: Boxes },
  { label: "Finance", path: "/finance", icon: BriefcaseBusiness },
  { label: "Automation", path: "/agents/mission-control", icon: Bot },
];

export const assetsSubnav: NavItem[] = [
  { label: "Overview", path: "/assets/overview", icon: BarChart3 },
  { label: "Assets", path: "/assets", icon: PackageSearch },
  { label: "Packing Slips", path: "/packing-slips", icon: ScrollText },
  { label: "Incidents", path: "/incidents", icon: ClipboardList },
];

export const financeSubnav: NavItem[] = [
  { label: "Overview", path: "/finance", icon: BarChart3 },
  { label: "Entries", path: "/finance/entries", icon: ScrollText },
  { label: "Review Queue", path: "/finance/cost-links", icon: ClipboardList },
];

export const agentsSubnav: NavItem[] = [
  { label: "Overview", path: "/agents/mission-control", icon: Bot },
  { label: "Team", path: "/agents", icon: Boxes },
  { label: "Activity", path: "/agents/runs", icon: ScrollText },
  { label: "AI Models", path: "/agents/models", icon: FolderCog },
  { label: "Channels", path: "/agents/connectors", icon: ClipboardList },
];

const projectSectionMeta: Record<ProjectRouteSection, Omit<NavItem, "path">> = {
  overview: { label: "Overview", icon: BarChart3 },
  assets: { label: "Assets", icon: PackageSearch },
  packing: { label: "Packing", icon: ScrollText },
  incidents: { label: "Incidents", icon: ClipboardList },
  budget: { label: "Budget", icon: Wallet },
  info: { label: "Details", icon: Info },
};

export const buildProjectSubnav = (projectId: string): NavItem[] =>
  (Object.entries(projectSectionMeta) as Array<[ProjectRouteSection, Omit<NavItem, "path">]>).map(([section, item]) => ({
    ...item,
    path: `/projects/${projectId}/${section}`,
  }));

export const utilityNav: NavItem[] = [
  { label: "Catalog", path: "/catalog", icon: FolderCog },
  { label: "Settings", path: "/settings", icon: Settings },
];
