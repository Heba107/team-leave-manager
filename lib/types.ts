export type LeaveType = "Annual" | "Sick" | "Emergency";
export type LeaveStatus = "Pending" | "Approved" | "Rejected";
export type DurationType = "full" | "half_am" | "half_pm" | "hourly";
export type Role = "admin" | "employee";

export const LEAVE_TYPES: LeaveType[] = ["Annual", "Sick", "Emergency"];
export const LEAVE_STATUSES: LeaveStatus[] = ["Pending", "Approved", "Rejected"];
export const DURATION_LABELS: Record<DurationType, string> = {
  full: "Full day(s)",
  half_am: "Half-day (Morning)",
  half_pm: "Half-day (Afternoon)",
  hourly: "Hourly permission (Ozon)",
};

export interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
  position: string;
  active: boolean;
  role: Role;
  /** Annual leave allowance in days. */
  annualAllowance: number;
  /** Supabase Auth user linked to this employee (null until they sign up). */
  userId: string | null;
  createdAt: string;
}

export interface Leave {
  id: string;
  employeeId: string;
  type: LeaveType;
  /** ISO date, YYYY-MM-DD */
  startDate: string;
  /** ISO date, YYYY-MM-DD (inclusive). Equal to startDate for half days and permissions. */
  endDate: string;
  durationType: DurationType;
  /** "HH:MM", hourly permissions only (optional). */
  startTime: string | null;
  endTime: string | null;
  /** Hourly permissions only. */
  hours: number | null;
  backupEmployeeId: string | null;
  /** Path in the leave-attachments storage bucket (sick leaves only). */
  attachmentPath: string | null;
  status: LeaveStatus;
  notes: string;
  createdAt: string;
}

export interface Holiday {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface Settings {
  /** Day-of-week numbers (0 = Sunday) that are not counted as leave days. */
  weekendDays: number[];
  /** Leave types whose days are deducted from the annual allowance. */
  deductingTypes: LeaveType[];
  /** Working hours per day, used to express permission hours as day-equivalents. */
  hoursPerDay: number;
}

/** Everything needed to turn a date range into a number of leave days. */
export interface Calendar {
  settings: Settings;
  holidays: Holiday[];
}

export interface DirectoryEntry {
  id: string;
  name: string;
  department: string;
}

export interface AppData extends Calendar {
  /** Admins: whole team. Employees: only themselves (enforced by the database). */
  employees: Employee[];
  leaves: Leave[];
  /** Names of all active colleagues (for backup person selection and labels). */
  directory: DirectoryEntry[];
  me: Employee;
}
