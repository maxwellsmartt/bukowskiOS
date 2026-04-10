import {
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  FolderKanban,
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
};

export const primaryNav: NavItem[] = [
  { label: "Overview", path: "/overview", icon: BarChart3 },
  { label: "Assets", path: "/assets", icon: Boxes },
  { label: "Finance", path: "/finance", icon: BriefcaseBusiness },
];

export const assetsSubnav: NavItem[] = [
  { label: "Assets", path: "/assets", icon: PackageSearch },
  { label: "Packing Slips", path: "/packing-slips", icon: ScrollText },
  { label: "Incidents", path: "/incidents", icon: ClipboardList },
  { label: "Projects", path: "/projects", icon: Building2 },
  { label: "Catalog", path: "/catalog", icon: FolderCog },
];

export const financeSubnav: NavItem[] = [
  { label: "Overview", path: "/finance", icon: BarChart3 },
  { label: "Cost Links", path: "/finance/cost-links", icon: ClipboardList },
  { label: "Entries", path: "/finance/entries", icon: ScrollText },
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
