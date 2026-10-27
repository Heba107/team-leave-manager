import type { Employee } from "./types";

/**
 * People who can be chosen as someone's direct manager: active admins (team leads and the
 * General Manager), never the person themselves. Sorted by name.
 */
export function managerOptions(employees: Employee[], selfId?: string): Employee[] {
  return employees
    .filter((e) => e.active && e.role === "admin" && e.id !== selfId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True if `managerId` is empty or one of the allowed managers. */
export function isValidManager(employees: Employee[], managerId: string | null, selfId?: string): boolean {
  return !managerId || managerOptions(employees, selfId).some((m) => m.id === managerId);
}
