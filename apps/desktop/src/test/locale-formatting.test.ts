import { describe, expect, it } from "vitest";

import { formatDateTime } from "@shared/lib/locale";

const localeContext = {
  language: "es",
  dateFormatMode: "locale" as const,
};

describe("locale date formatting", () => {
  it("treats SQLite CURRENT_TIMESTAMP values as UTC", () => {
    const sqliteTimestamp = "2026-06-13 17:42:00";
    const isoTimestamp = "2026-06-13T17:42:00Z";

    expect(formatDateTime(sqliteTimestamp, localeContext)).toBe(formatDateTime(isoTimestamp, localeContext));
  });
});
