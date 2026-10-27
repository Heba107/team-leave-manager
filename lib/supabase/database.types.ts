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
  manager_id: string | null;
  squad_id: string | null;
  opening_balance_2026: number | null;
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
  handover_reminder_sent_at: string | null;
  created_at: string;
};

type SquadRow = { id: string; name: string; lead_id: string | null; created_at: string };

type HolidayRow = { id: string; name: string; start_date: string; end_date: string; created_at: string };

type SettingsRow = {
  id: number;
  weekend_days: number[];
  deducting_types: string[];
  hours_per_day: number;
  allowed_signup_domains: string[];
  general_manager_id: string | null;
  carry_forward_enabled: boolean;
  carry_forward_from_year: number;
};

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: EmployeeRow;
        Insert: Optional<
          EmployeeRow,
          | "id"
          | "email"
          | "department"
          | "position"
          | "active"
          | "role"
          | "user_id"
          | "manager_id"
          | "squad_id"
          | "opening_balance_2026"
          | "annual_allowance"
          | "created_at"
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
          | "handover_reminder_sent_at"
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
      squads: {
        Row: SquadRow;
        Insert: Optional<SquadRow, "id" | "lead_id" | "created_at">;
        Update: Partial<SquadRow>;
        Relationships: [];
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
      backup_conflict: {
        Args: { p_backup: string; p_start: string; p_end: string };
        Returns: { name: string; start_date: string; end_date: string; status: "Approved" | "Pending" } | null;
      };
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
  /** employee: direct manager + General Manager; team_lead: General Manager; admin_fallback: other admins. */
  recipient_rule: "employee" | "team_lead" | "admin_fallback";
  recipients: { name: string; email: string; why: "direct_manager" | "general_manager" | "admin_fallback" }[];
  /** Direct manager + squad lead: receive the Jira handover summary when the leave is approved. */
  handover_recipients: { name: string; email: string; why: "direct_manager" | "squad_lead" }[];
  squad: string | null;
}
