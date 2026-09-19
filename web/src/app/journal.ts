export interface Track { id: string; name: string; description: string; icon: string; color: string; archived: boolean; createdAt: string; }
export interface Activity { id: string; projectId: string; date: string; title: string; description: string; value: number | null; unit: string | null; createdAt: string; }
export function dateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function addDays(date: string, amount: number): string { const d = new Date(date+'T12:00:00'); d.setDate(d.getDate()+amount); return dateKey(d); }
export function statistics(activities: Activity[], today = dateKey(new Date())) {
  const days = [...new Set(activities.filter(a => a.date <= today).map(a => a.date))].sort();
  const set = new Set(days); let current = 0; let cursor = set.has(today) ? today : addDays(today,-1);
  while (set.has(cursor)) { current++; cursor = addDays(cursor,-1); }
  let longest = 0, run = 0, previous = '';
  for (const day of days) { run = previous && addDays(previous,1) === day ? run+1 : 1; longest = Math.max(longest,run); previous = day; }
  return { activeDays: days.length, total: activities.length, current, longest };
}
