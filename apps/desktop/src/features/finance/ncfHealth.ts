export type NcfHealthStatus = "missing" | "expired" | "exhausted" | "low" | "expiring" | "ready";

export type NcfHealthTone = "neutral" | "success" | "warning" | "critical";

export type NcfHealthInput = {
  ncfSeriesActive?: string | null;
  ncfSequenceNext?: number | null;
  ncfSequenceMax?: number | null;
  ncfExpiresAt?: string | null;
  today?: Date;
};

export type NcfHealth = {
  status: NcfHealthStatus;
  tone: NcfHealthTone;
  canIssue: boolean;
  remaining: number | null;
  percentRemaining: number | null;
  daysUntilExpiry: number | null;
  series: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDayUtc = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

const parseDateOnly = (value?: string | null) => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

export const evaluateNcfHealth = ({
  ncfSeriesActive,
  ncfSequenceNext,
  ncfSequenceMax,
  ncfExpiresAt,
  today = new Date(),
}: NcfHealthInput): NcfHealth => {
  const series = ncfSeriesActive?.trim().toUpperCase() || null;
  const next = Number(ncfSequenceNext);
  const max = Number(ncfSequenceMax);
  const hasSequence = Number.isFinite(next) && Number.isFinite(max) && next > 0 && max > 0;

  if (!series || !hasSequence) {
    return {
      status: "missing",
      tone: "neutral",
      canIssue: false,
      remaining: null,
      percentRemaining: null,
      daysUntilExpiry: null,
      series,
    };
  }

  const remaining = Math.max(0, Math.floor(max - next + 1));
  const percentRemaining = max > 0 ? Math.max(0, Math.min(1, remaining / max)) : null;
  const expiry = parseDateOnly(ncfExpiresAt);
  const daysUntilExpiry =
    expiry === null ? null : Math.ceil((startOfDayUtc(expiry) - startOfDayUtc(today)) / MS_PER_DAY);

  if (remaining <= 0) {
    return { status: "exhausted", tone: "critical", canIssue: false, remaining, percentRemaining, daysUntilExpiry, series };
  }

  if (daysUntilExpiry !== null && daysUntilExpiry < 0) {
    return { status: "expired", tone: "critical", canIssue: false, remaining, percentRemaining, daysUntilExpiry, series };
  }

  if (remaining <= 10 || (percentRemaining !== null && percentRemaining <= 0.1)) {
    return { status: "low", tone: "warning", canIssue: true, remaining, percentRemaining, daysUntilExpiry, series };
  }

  if (daysUntilExpiry !== null && daysUntilExpiry <= 30) {
    return { status: "expiring", tone: "warning", canIssue: true, remaining, percentRemaining, daysUntilExpiry, series };
  }

  return { status: "ready", tone: "success", canIssue: true, remaining, percentRemaining, daysUntilExpiry, series };
};
