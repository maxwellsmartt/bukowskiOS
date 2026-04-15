export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type BukowskiDatabase = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          base_currency: string;
          icon_color: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          base_currency?: string;
          icon_color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["workspaces"]["Insert"]>;
      };
      workspace_memberships: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role_id: string | null;
          status: "active" | "invited" | "inactive";
          invited_by: string | null;
          invited_at: string | null;
          accepted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          role_id?: string | null;
          status?: "active" | "invited" | "inactive";
          invited_by?: string | null;
          invited_at?: string | null;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["workspace_memberships"]["Insert"]>;
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          workspace_id: string;
          kind: string;
          title: string;
          body: string | null;
          source_type: string | null;
          source_ref: Json | null;
          link_to: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          workspace_id: string;
          kind: string;
          title: string;
          body?: string | null;
          source_type?: string | null;
          source_ref?: Json | null;
          link_to?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["notifications"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      has_permission: {
        Args: {
          target_workspace_id: string;
          permission_key: string;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
