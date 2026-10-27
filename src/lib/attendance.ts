export const attendanceRoles: Record<string, string> = {
  front_desk: "Front Desk", artist: "Artist / Layout", printing: "Printer",
  heat_press: "Heat Press", qc: "Quality Control",
};
export const punchLabels = { am_in: "AM time in", am_out: "AM time out", pm_in: "PM time in", pm_out: "PM time out" };
export type Punch = keyof typeof punchLabels;
export type TimeLog = { am_in: string | null; am_out: string | null; pm_in: string | null; pm_out: string | null };
export const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
export const money = (value: number | string | null) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value ?? 0));
export function timeLabel(value: string | null) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}
export function logStatus(log: TimeLog) {
  if (!log.am_in && !log.am_out && !log.pm_in && !log.pm_out) return "Absent";
  if ((log.am_in && !log.am_out) || (log.pm_in && !log.pm_out)) return "Incomplete";
  if (log.am_in && log.am_out && log.pm_in && log.pm_out) return "Complete";
  return "Half day";
}
