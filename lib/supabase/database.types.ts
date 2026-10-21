// Hand-written to match the SQL in supabase/migrations/.
// Can be regenerated with: npx supabase gen types typescript --project-id fszjvcdfjfjtihrwkgyd

type LeaveType = "Annual" | "Sick" | "Emergency";
type LeaveStatus = "Pending" | "Approved" | "Rejected";
type DurationType = "full" | "half_am" | "half_pm" | "hourly";

type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  department: string;
  position: string;
  active: boolean;
  role: "admin" | "employee";
  user_id: string | null;
  annual_allowance: number;
  created_at: string;
};

type LeaveRow = {
  id: string;
  employee_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  status: LeaveStatus;
  notes: string;
  duration_type: DurationType;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  backup_employee_id: string | null;
  attachment_path: string | null;
  /** Calculated by the database (weekends and public holidays excluded); read-only for the app. */
  leave_days: number | null;
  created_at: string;
};

type HolidayRow = { id: string; name: string; start_date: string; end_date: string; created_at: string };

type SettingsRow = { id: number; weekend_days: number[]; deducting_types: string[]; hours_per_day: number };

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: EmployeeRow;
        Insert: Optional<
          EmployeeRow,
          "id" | "email" | "department" | "position" | "active" | "role" | "user_id" | "annual_allowance" | "created_at"
        >;
        Update: Partial<EmployeeRow>;
        Relationships: [];
      };
      leaves: {
        Row: LeaveRow;
        Insert: Optional<
          LeaveRow,
          | "id"
          | "status"
          | "notes"
          | "duration_type"
          | "start_time"
          | "end_time"
          | "hours"
          | "backup_employee_id"
          | "attachment_path"
          | "leave_days"
          | "created_at"
        >;
        Update: Partial<LeaveRow>;
        Relationships: [
          {
            foreignKeyName: "leaves_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leaves_backup_employee_id_fkey";
            columns: ["backup_employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      public_holidays: {
        Row: HolidayRow;
        Insert: Optional<HolidayRow, "id" | "created_at">;
        Update: Partial<HolidayRow>;
        Relationships: [];
      };
      app_settings: {
        Row: SettingsRow;
        Insert: Partial<SettingsRow>;
        Update: Partial<SettingsRow>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: { Args: Record<never, never>; Returns: boolean };
      current_employee_id: { Args: Record<never, never>; Returns: string | null };
      employee_directory: {
        Args: Record<never, never>;
        Returns: { id: string; name: string; department: string }[];
      };
      leave_notification: { Args: { p_leave_id: string }; Returns: LeaveNotification | null };
      compute_leave_days: { Args: { p_start: string; p_end: string; p_duration: string }; Returns: number };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

export interface LeaveNotification {
  leave: {
    id: string;
    type: LeaveType;
    status: LeaveStatus;
    start_date: string;
    end_date: string;
    duration_type: DurationType;
    start_time: string | null;
    end_time: string | null;
    hours: number | null;
    notes: string;
    has_attachment: boolean;
  };
  employee: { name: string; email: string };
  backup: string | null;
  caller_is_admin: boolean;
  admins: { name: string; email: string }[];
}
