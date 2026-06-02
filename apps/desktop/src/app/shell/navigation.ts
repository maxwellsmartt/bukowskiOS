import {
  Activity,
  Bot,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  FileText,
  CalendarDays,
  AlertTriangle,
  FolderCog,
  FolderKanban,
  FolderOpenDot,
  Gauge,
  Info,
  Inbox,
  KeyRound,
  Landmark,
  LineChart,
  ListChecks,
  Package,
  PackageOpen,
  PackageSearch,
  Radio,
  Receipt,
  ScrollText,
  Settings,
  SwatchBook,
  Users,
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
  { label: "shell.nav.primary.projects", path: "/projects/schedule", icon: FolderKanban },
  { label: "shell.nav.primary.assets", path: "/assets", icon: Package },
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
  { label: "shell.nav.assets.packingSlips", path: "/packing-slips", icon: PackageOpen },
  { label: "shell.nav.assets.incidents", path: "/incidents", icon: AlertTriangle },
];

export const financeSubnav: NavItem[] = [
  { label: "shell.nav.finance.overview", path: "/finance", icon: LineChart },
  { label: "shell.nav.finance.treasury", path: "/finance/treasury", icon: Landmark },
  { label: "shell.nav.finance.quotes", path: "/finance/quotes", icon: FileText },
  { label: "shell.nav.finance.invoices", path: "/finance/invoices", icon: Receipt },
  { label: "shell.nav.finance.collaborators", path: "/finance/collaborators", icon: Users },
  { label: "shell.nav.finance.entries", path: "/finance/entries", icon: BookOpen },
  { label: "shell.nav.finance.reviewQueue", path: "/finance/cost-links", icon: ListChecks },
];

export const agentsSubnav: NavItem[] = [
  { label: "shell.nav.agents.overview", path: "/agents/mission-control", icon: Bot },
  { label: "shell.nav.agents.team", path: "/agents", icon: Users },
  { label: "shell.nav.agents.activity", path: "/agents/runs", icon: Activity },
  { label: "shell.nav.agents.models", path: "/agents/models", icon: FolderCog },
  { label: "shell.nav.agents.channels", path: "/agents/connectors", icon: Radio },
];

const projectSectionMeta: Record<ProjectRouteSection, Omit<NavItem, "path">> = {
  overview: { label: "shell.nav.project.overview", icon: Gauge },
  assets: { label: "shell.nav.project.assets", icon: PackageSearch },
  packing: { label: "shell.nav.project.packing", icon: PackageOpen },
  incidents: { label: "shell.nav.project.incidents", icon: AlertTriangle },
  budget: { label: "shell.nav.project.budget", icon: BarChart3 },
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
