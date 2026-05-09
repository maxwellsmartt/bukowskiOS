import {
  Bot,
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  FileText,
  Building2,
  CalendarDays,
  ClipboardList,
  FolderCog,
  FolderOpenDot,
  Info,
  Inbox,
  KeyRound,
  PackageSearch,
  ScrollText,
  Settings,
  SwatchBook,
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
  { label: "Projects", path: "/projects/schedule", icon: FolderOpenDot },
  { label: "Assets", path: "/assets", icon: Boxes },
  { label: "Finance", path: "/finance", icon: BriefcaseBusiness },
  { label: "Inbox", path: "/inbox", icon: Inbox },
  { label: "Automation", path: "/agents/mission-control", icon: Bot },
];

export const projectsSubnav: NavItem[] = [
  { label: "Schedule Overview", path: "/projects/schedule", icon: CalendarDays },
  { label: "Projects", path: "/projects", icon: FolderOpenDot },
];

export const assetsSubnav: NavItem[] = [
  { label: "Assets", path: "/assets", icon: PackageSearch },
  { label: "Licenses", path: "/assets/licenses", icon: KeyRound },
  { label: "Packing Slips", path: "/packing-slips", icon: ScrollText },
  { label: "Incidents", path: "/incidents", icon: ClipboardList },
];

export const financeSubnav: NavItem[] = [
  { label: "Overview", path: "/finance", icon: BarChart3 },
  { label: "Quotes", path: "/finance/quotes", icon: FileText },
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

const projectSectionOrder: ProjectRouteSection[] = ["info", "overview", "assets", "packing", "incidents", "budget"];

export const buildProjectSubnav = (projectId: string): NavItem[] =>
  projectSectionOrder.map((section) => ({
    ...projectSectionMeta[section],
    path: `/projects/${projectId}/${section}`,
  }));

export const utilityNav: NavItem[] = [
  { label: "Catalog", path: "/catalog", icon: SwatchBook },
  { label: "Settings", path: "/settings", icon: Settings },
];
