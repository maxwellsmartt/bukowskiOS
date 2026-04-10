export type DerivedProjectUnitStatus = "planned" | "active" | "wrapped" | "cancelled";
export type ProjectUnitStatusSource = "derived" | "manual_override";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const toUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

export const isValidDateOnly = (value: string) => isoDatePattern.test(value) && !Number.isNaN(toUtcDate(value).getTime());

export const normalizeDateOnly = (value?: string | null) => {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  if (!isValidDateOnly(trimmedValue)) {
    throw new Error(`Invalid date value "${value}". Expected YYYY-MM-DD.`);
  }

  return trimmedValue;
};

export const assertDateWindow = (startDate: string | null, endDate: string | null, label: string) => {
  if (startDate && endDate && toUtcDate(endDate).getTime() < toUtcDate(startDate).getTime()) {
    throw new Error(`${label} end date cannot be earlier than start date.`);
  }
};

export const deriveProjectUnitStatus = (
  startDate: string | null,
  endDate: string | null,
  storedStatus: string | null,
  statusSource: string | null,
) => {
  if (storedStatus === "cancelled" && statusSource === "manual_override") {
    return {
      status: "cancelled" as const,
      statusSource: "manual_override" as const,
    };
  }

  const today = todayUtc().getTime();

  if (startDate) {
    const startTime = toUtcDate(startDate).getTime();
    if (startTime > today) {
      return { status: "planned" as const, statusSource: "derived" as const };
    }
  }

  if (endDate) {
    const endTime = toUtcDate(endDate).getTime();
    if (endTime < today) {
      return { status: "wrapped" as const, statusSource: "derived" as const };
    }
  }

  return { status: "active" as const, statusSource: "derived" as const };
};

export const resolveScheduleWindowLabel = (startDate: string | null, endDate: string | null) => {
  if (!startDate && !endDate) {
    return "Unscheduled";
  }

  if (startDate && endDate) {
    return `${startDate} → ${endDate}`;
  }

  if (startDate) {
    return `${startDate} → Open`;
  }

  return `Until ${endDate}`;
};

export const todayDateOnly = () => new Date().toISOString().slice(0, 10);
