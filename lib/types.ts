export type LeaveType = "Annual" | "Sick" | "Emergency";
export type LeaveStatus = "Pending" | "Approved" | "Rejected";

export const LEAVE_TYPES: LeaveType[] = ["Annual", "Sick", "Emergency"];
export const LEAVE_STATUSES: LeaveStatus[] = ["Pending", "Approved", "Rejected"];

export interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
  position: string;
  active: boolean;
  createdAt: string;
}

export interface Leave {
  id: string;
  employeeId: string;
  type: LeaveType;
  /** ISO date, YYYY-MM-DD */
  startDate: string;
  /** ISO date, YYYY-MM-DD (inclusive) */
  endDate: string;
  status: LeaveStatus;
  notes: string;
  createdAt: string;
}

export interface Settings {
  /** Day-of-week numbers (0 = Sunday) that are not counted as leave days. */
  weekendDays: number[];
}

export interface AppData {
  employees: Employee[];
  leaves: Leave[];
  settings: Settings;
}
