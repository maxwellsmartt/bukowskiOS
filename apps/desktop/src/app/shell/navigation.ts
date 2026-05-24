import {
  Bot,
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  FileText,
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

/**
 * Nav entry. `label` is an i18n key (e.g. `"shell.nav.primary.projects"`).
 * Consumers must wrap it in `t(item.label)` — we keep keys here rather
 * than localized strings so the structure stays a static const and
 * locale switches reflect on the next render.
 */
export type NavItem = {
  label: string;
  path: string;
  icon?: LucideIcon;
  tone?: "default" | "accent";
};

export const primaryNav: NavItem[] = [
  { label: "shell.nav.primary.projects", path: "/projects/schedule", icon: FolderOpenDot },
  { label: "shell.nav.primary.assets", path: "/assets", icon: Boxes },
  { label: "shell.nav.primary.finance", path: "/finance", icon: BriefcaseBusiness },
  { label: "shell.nav.primary.inbox", path: "/inbox", icon: Inbox },
  { label: "shell.nav.primary.automation", path: "/agents/mission-control", icon: Bot },
];

export const projectsSubnav: NavItem[] = [
  { label: "shell.nav.projects.schedule", path: "/projects/schedule", icon: CalendarDays },
  { label: "shell.nav.projects.projects", path: "/projects", icon: FolderOpenDot },
];

export const assetsSubnav: NavItem[] = [
  { label: "shell.nav.assets.assets", path: "/assets", icon: PackageSearch },
  { label: "shell.nav.assets.licenses", path: "/assets/licenses", icon: KeyRound },
  { label: "shell.nav.assets.packingSlips", path: "/packing-slips", icon: ScrollText },
  { label: "shell.nav.assets.incidents", path: "/incidents", icon: ClipboardList },
];

export const financeSubnav: NavItem[] = [
  { label: "shell.nav.finance.overview", path: "/finance", icon: BarChart3 },
  { label: "shell.nav.finance.treasury", path: "/finance/treasury", icon: Wallet },
  { label: "shell.nav.finance.quotes", path: "/finance/quotes", icon: FileText },
  { label: "shell.nav.finance.invoices", path: "/finance/invoices", icon: ScrollText },
  { label: "shell.nav.finance.collaborators", path: "/finance/collaborators", icon: Wallet },
  { label: "shell.nav.finance.entries", path: "/finance/entries", icon: ScrollText },
  { label: "shell.nav.finance.reviewQueue", path: "/finance/cost-links", icon: ClipboardList },
];

export const agentsSubnav: NavItem[] = [
  { label: "shell.nav.agents.overview", path: "/agents/mission-control", icon: Bot },
  { label: "shell.nav.agents.team", path: "/agents", icon: Boxes },
  { label: "shell.nav.agents.activity", path: "/agents/runs", icon: ScrollText },
  { label: "shell.nav.agents.models", path: "/agents/models", icon: FolderCog },
  { label: "shell.nav.agents.channels", path: "/agents/connectors", icon: ClipboardList },
];

const projectSectionMeta: Record<ProjectRouteSection, Omit<NavItem, "path">> = {
  overview: { label: "shell.nav.project.overview", icon: BarChart3 },
  assets: { label: "shell.nav.project.assets", icon: PackageSearch },
  packing: { label: "shell.nav.project.packing", icon: ScrollText },
  incidents: { label: "shell.nav.project.incidents", icon: ClipboardList },
  budget: { label: "shell.nav.project.budget", icon: Wallet },
  info: { label: "shell.nav.project.info", icon: Info },
};

const projectSectionOrder: ProjectRouteSection[] = ["info", "overview", "assets", "packing", "incidents", "budget"];

export const buildProjectSubnav = (projectId: string): NavItem[] =>
  projectSectionOrder.map((section) => ({
    ...projectSectionMeta[section],
    path: `/projects/${projectId}/${section}`,
  }));

export const utilityNav: NavItem[] = [
  { label: "shell.nav.utility.catalog", path: "/catalog", icon: SwatchBook },
  { label: "shell.nav.utility.settings", path: "/settings", icon: Settings },
];
