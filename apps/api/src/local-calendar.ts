// Pure date helpers shared by the calendar UI and contract tests. No server state.
export function localMinute(instant: string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function localCandidates(value: string, timeZone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const naive = Date.parse(value + "Z");
  if (
    !Number.isFinite(naive) ||
    new Date(naive).toISOString().slice(0, 16) !== value
  )
    return [];
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    const t = naive + h * 3600000;
    offsets.add(Date.parse(localMinute(t, timeZone) + "Z") - t);
  }
  return [...offsets]
    .map((o) => naive - o)
    .filter((t) => localMinute(t, timeZone) === value)
    .sort((a, b) => a - b)
    .map((t) => new Date(t).toISOString());
}
export function addDays(date: string, n: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function dayStart(date: string, timeZone: string) {
  // Midnight can be skipped in some zones. Choose the first valid minute on this
  // date, and reject an entirely skipped date rather than inventing an instant.
  for (let m = 0; m < 1440; m++) {
    const candidates = localCandidates(
      `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      timeZone,
    );
    if (candidates.length) return candidates[0];
  }
  throw new Error(
    "This date does not exist in the selected time zone. Choose another date.",
  );
}
