/**
 * Timezone utilities — Bibek Enterprises
 * All dates/times display in IST (Asia/Kolkata, UTC+5:30).
 * The API stores UTC; these helpers convert for display.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5h 30m

/** Today's date string (YYYY-MM-DD) in IST */
export function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.toISOString().split("T")[0];
}

/** Current IST Date object */
export function nowIST(): Date {
  const now = new Date();
  return new Date(now.getTime() + IST_OFFSET_MS);
}

/** Current IST hour (0-23) */
export function currentHourIST(): number {
  return nowIST().getUTCHours();
}

/**
 * Format a UTC ISO string or Date for display in IST.
 * Returns "DD Mon YYYY" by default.
 */
export function fmtDateIST(
  value: string | Date | undefined | null,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

/**
 * Format a UTC ISO string for display with time in IST.
 * Returns "DD Mon YYYY, HH:MM AM/PM"
 */
export function fmtDateTimeIST(
  value: string | Date | undefined | null,
  opts: Intl.DateTimeFormatOptions = {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

/**
 * Format just time in IST. Returns "HH:MM AM/PM"
 */
export function fmtTimeIST(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Relative time string ("2 min ago", "3 days ago") in IST context.
 */
export function relativeTimeIST(iso: string | undefined | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} days ago`;
  return fmtDateIST(iso);
}

/**
 * Build a scheduled_date ISO string for booking submission.
 * Takes a YYYY-MM-DD string (selected in IST) and returns
 * midnight IST as a proper UTC ISO string.
 */
export function bookingDateISO(dateStr: string): string {
  // dateStr is YYYY-MM-DD in IST — treat it as IST midnight
  // IST midnight = UTC (date - 1) 18:30:00
  const [y, m, d] = dateStr.split("-").map(Number);
  const midnightIST = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS);
  return midnightIST.toISOString();
}
