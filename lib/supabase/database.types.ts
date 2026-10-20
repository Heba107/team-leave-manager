// Hand-written to match supabase/migrations/20261020000000_init_team_leave.sql.
// Can be regenerated with: npx supabase gen types typescript --project-id fszjvcdfjfjtihrwkgyd

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: {
          id: string;
          name: string;
          email: string;
          department: string;
          position: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email?: string;
          department?: string;
          position?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["employees"]["Insert"]>;
        Relationships: [];
      };
      leaves: {
        Row: {
          id: string;
          employee_id: string;
          type: "Annual" | "Sick" | "Emergency";
          start_date: string;
          end_date: string;
          status: "Pending" | "Approved" | "Rejected";
          notes: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          type: "Annual" | "Sick" | "Emergency";
          start_date: string;
          end_date: string;
          status?: "Pending" | "Approved" | "Rejected";
          notes?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["leaves"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "leaves_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: { id: number; weekend_days: number[] };
        Insert: { id?: number; weekend_days?: number[] };
        Update: { id?: number; weekend_days?: number[] };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
