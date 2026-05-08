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
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          base_currency?: string;
          icon_color?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["workspaces"]["Insert"]>;
      };
      user_profiles: {
        Row: {
          user_id: string;
          email: string | null;
          full_name: string | null;
          phone: string | null;
          avatar_url: string | null;
          preferences_json: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          email?: string | null;
          full_name?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          preferences_json?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["user_profiles"]["Insert"]>;
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
      workspace_system_actors: {
        Row: {
          id: string;
          workspace_id: string;
          key: string;
          name: string;
          email: string | null;
          kind: "agent" | "integration" | "system";
          description: string | null;
          status: "active" | "paused" | "inactive";
          metadata_json: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          key: string;
          name: string;
          email?: string | null;
          kind?: "agent" | "integration" | "system";
          description?: string | null;
          status?: "active" | "paused" | "inactive";
          metadata_json?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["workspace_system_actors"]["Insert"]>;
      };
      workspace_system_actor_permissions: {
        Row: {
          actor_id: string;
          permission_id: string;
          created_at: string;
        };
        Insert: {
          actor_id: string;
          permission_id: string;
          created_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["workspace_system_actor_permissions"]["Insert"]>;
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
      todos: {
        Row: {
          id: string;
          user_id: string;
          workspace_id: string;
          title: string;
          notes: string | null;
          due_at: string | null;
          priority: number;
          completed_at: string | null;
          created_by: "user" | "agent";
          agent_action_ref: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          workspace_id: string;
          title: string;
          notes?: string | null;
          due_at?: string | null;
          priority?: number;
          completed_at?: string | null;
          created_by?: "user" | "agent";
          agent_action_ref?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["todos"]["Insert"]>;
      };
      reminders: {
        Row: {
          id: string;
          user_id: string;
          workspace_id: string;
          title: string;
          body: string | null;
          remind_at: string;
          recurrence_rule: string | null;
          snoozed_until: string | null;
          completed_at: string | null;
          created_by: "user" | "agent";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          workspace_id: string;
          title: string;
          body?: string | null;
          remind_at: string;
          recurrence_rule?: string | null;
          snoozed_until?: string | null;
          completed_at?: string | null;
          created_by?: "user" | "agent";
          created_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["reminders"]["Insert"]>;
      };
      sync_outbox: {
        Row: {
          id: string;
          workspace_id: string;
          entity_type: string;
          entity_id: string;
          event_id: string | null;
          operation_type: string;
          payload_json: Json;
          status: "pending" | "processing" | "failed" | "sent";
          attempt_count: number;
          last_error: string | null;
          next_retry_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          workspace_id: string;
          entity_type: string;
          entity_id: string;
          event_id?: string | null;
          operation_type: string;
          payload_json: Json;
          status?: "pending" | "processing" | "failed" | "sent";
          attempt_count?: number;
          last_error?: string | null;
          next_retry_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BukowskiDatabase["public"]["Tables"]["sync_outbox"]["Insert"]>;
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
