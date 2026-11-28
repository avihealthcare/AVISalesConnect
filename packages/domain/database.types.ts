export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: string
          created_at: string
          id: string
          name: string
          organization_id: string
          resource_type: string | null
          display_number: number
          master_version: number
        }
        Insert: {
          account_type: string
          created_at?: string
          id: string
          name: string
          organization_id: string
          resource_type?: never
          display_number?: never
          master_version?: number
        }
        Update: {
          account_type?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          resource_type?: never
          display_number?: never
          master_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounts_organization_id_id_resource_type_fkey"
            columns: ["organization_id", "id", "resource_type"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id", "resource_type"]
          },
        ]
      }
      lead_contact_attempts: {
        Row: {
          actor_membership_id: string
          attempted_at: string
          id: string
          lead_id: string
          notes: string | null
          organization_id: string
          outcome: string
        }
        Insert: {
          actor_membership_id: string
          attempted_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          organization_id: string
          outcome: string
        }
        Update: {
          actor_membership_id?: string
          attempted_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          organization_id?: string
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_contact_attempts_organization_id_actor_membership_id_fkey"
            columns: ["organization_id", "actor_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_contact_attempts_organization_id_lead_id_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      leads: {
        Row: {
          account_id: string | null
          contact_route: string | null
          display_number: number
          disqualification_reason: string | null
          first_attempt_at: string | null
          first_successful_contact_at: string | null
          id: string
          ingested_at: string
          lifecycle: string
          missing_contact_reason: string | null
          next_action: string | null
          next_action_due_at: string | null
          organization_id: string
          prospect_name: string
          received_at: string
          requirement_text: string | null
          resource_type: string | null
          row_version: number
          source: string
          alternate_mobile: string | null
          budget: number | null
          city: string | null
          competitor: string | null
          contact_person: string | null
          country: string | null
          created_by: string | null
          customer_type: string | null
          description: string | null
          designation: string | null
          email: string | null
          expected_purchase_on: string | null
          expected_value: number | null
          external_reference: string | null
          loss_reason: string | null
          merged_into: string | null
          product_revision: number
          mobile: string | null
          priority: string
          probability: number | null
          sales_stage: string
          source_key: string
          state: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          contact_route?: string | null
          display_number?: never
          disqualification_reason?: string | null
          first_attempt_at?: string | null
          first_successful_contact_at?: string | null
          id: string
          ingested_at?: string
          lifecycle?: string
          missing_contact_reason?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          organization_id: string
          prospect_name: string
          received_at: string
          requirement_text?: string | null
          resource_type?: never
          row_version?: number
          source: string
          alternate_mobile?: string | null
          budget?: number | null
          city?: string | null
          competitor?: string | null
          contact_person?: string | null
          country?: string | null
          created_by?: string | null
          customer_type?: string | null
          description?: string | null
          designation?: string | null
          email?: string | null
          expected_purchase_on?: string | null
          expected_value?: number | null
          external_reference?: string | null
          loss_reason?: string | null
          merged_into?: string | null
          product_revision?: number
          mobile?: string | null
          priority?: string
          probability?: number | null
          sales_stage?: string
          source_key?: string
          state?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          contact_route?: string | null
          display_number?: never
          disqualification_reason?: string | null
          first_attempt_at?: string | null
          first_successful_contact_at?: string | null
          id?: string
          ingested_at?: string
          lifecycle?: string
          missing_contact_reason?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          organization_id?: string
          prospect_name?: string
          received_at?: string
          requirement_text?: string | null
          resource_type?: never
          row_version?: number
          source?: string
          alternate_mobile?: string | null
          budget?: number | null
          city?: string | null
          competitor?: string | null
          contact_person?: string | null
          country?: string | null
          created_by?: string | null
          customer_type?: string | null
          description?: string | null
          designation?: string | null
          email?: string | null
          expected_purchase_on?: string | null
          expected_value?: number | null
          external_reference?: string | null
          loss_reason?: string | null
          merged_into?: string | null
          product_revision?: number
          mobile?: string | null
          priority?: string
          probability?: number | null
          sales_stage?: string
          source_key?: string
          state?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_account_id_fkey"
            columns: ["organization_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leads_organization_id_id_resource_type_fkey"
            columns: ["organization_id", "id", "resource_type"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id", "resource_type"]
          },
        ]
      }
      member_roles: {
        Row: {
          effective_from: string
          effective_to: string | null
          id: string
          membership_id: string
          organization_id: string
          role_id: string
        }
        Insert: {
          effective_from: string
          effective_to?: string | null
          id?: string
          membership_id: string
          organization_id: string
          role_id: string
        }
        Update: {
          effective_from?: string
          effective_to?: string | null
          id?: string
          membership_id?: string
          organization_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roles_organization_id_membership_id_fkey"
            columns: ["organization_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "member_roles_organization_id_role_id_fkey"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          employee_code: string | null
          id: string
          organization_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          employee_code?: string | null
          id?: string
          organization_id: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          employee_code?: string | null
          id?: string
          organization_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          account_id: string
          created_at: string
          estimate_reason: string | null
          estimated_net_inr: number | null
          id: string
          organization_id: string
          origin_lead_id: string
          probability_percent: number | null
          requirement_text: string
          resource_type: string | null
          row_version: number
          stage: string
          weighted_net_inr: number | null
        }
        Insert: {
          account_id: string
          created_at?: string
          estimate_reason?: string | null
          estimated_net_inr?: number | null
          id: string
          organization_id: string
          origin_lead_id: string
          probability_percent?: number | null
          requirement_text: string
          resource_type?: never
          row_version?: number
          stage?: string
          weighted_net_inr?: never
        }
        Update: {
          account_id?: string
          created_at?: string
          estimate_reason?: string | null
          estimated_net_inr?: number | null
          id?: string
          organization_id?: string
          origin_lead_id?: string
          probability_percent?: number | null
          requirement_text?: string
          resource_type?: never
          row_version?: number
          stage?: string
          weighted_net_inr?: never
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_organization_id_account_id_fkey"
            columns: ["organization_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "opportunities_organization_id_id_resource_type_fkey"
            columns: ["organization_id", "id", "resource_type"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id", "resource_type"]
          },
          {
            foreignKeyName: "opportunities_organization_id_origin_lead_id_fkey"
            columns: ["organization_id", "origin_lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organizations: {
        Row: {
          base_currency: string
          created_at: string
          financial_year_start_month: number
          id: string
          name: string
          timezone: string
        }
        Insert: {
          base_currency: string
          created_at?: string
          financial_year_start_month: number
          id?: string
          name: string
          timezone: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          financial_year_start_month?: number
          id?: string
          name?: string
          timezone?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          code: string
          description: string
          requires_mfa: boolean
        }
        Insert: {
          code: string
          description: string
          requires_mfa?: boolean
        }
        Update: {
          code?: string
          description?: string
          requires_mfa?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          display_name: string
          id: string
          phone: string | null
        }
        Insert: {
          display_name: string
          id: string
          phone?: string | null
        }
        Update: {
          display_name?: string
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      resources: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          organization_id: string
          owner_membership_id: string | null
          resource_type: string
          territory_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          owner_membership_id?: string | null
          resource_type: string
          territory_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          owner_membership_id?: string | null
          resource_type?: string
          territory_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_organization_id_owner_membership_id_fkey"
            columns: ["organization_id", "owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          organization_id: string
          permission_code: string
          role_id: string
        }
        Insert: {
          organization_id: string
          permission_code: string
          role_id: string
        }
        Update: {
          organization_id?: string
          permission_code?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_organization_id_role_id_fkey"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          delegable: boolean
          id: string
          name: string
          organization_id: string
          requires_mfa: boolean
        }
        Insert: {
          code: string
          delegable?: boolean
          id?: string
          name: string
          organization_id: string
          requires_mfa?: boolean
        }
        Update: {
          code?: string
          delegable?: boolean
          id?: string
          name?: string
          organization_id?: string
          requires_mfa?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      read_lead_console: { Args: { p_org: string }; Returns: Json; };
      schedule_lead_demo: {
        Args: { p_org: string; p_id: string; p_key: string; p_version: number; p_due: string; p_note?: string };
        Returns: Json;
      };
      workspace_access: { Args: {p_org:string}; Returns: Json };
      workspace_password_required: { Args: Record<never,never>; Returns: boolean };
      workspace_user_directory: { Args: {p_org:string}; Returns: Json };
      assign_customer_leads: { Args: { p_org:string; p_key:string; p_input:Json }; Returns: Json };
      customer_activities: {Args:{p_org:string;p_id:string};Returns:Json};
      log_customer_activity: {Args:{p_org:string;p_id:string;p_key:string;p_kind:string;p_summary:string};Returns:undefined};
      enterprise_customer_directory: { Args: { p_org:string; p_query?:Json }; Returns: Json };
      create_card_lead: { Args: { p_org: string; p_key: string; p_input: Json }; Returns: Json };
      find_card_matches: {
        Args: { p_org: string; p_hospital: string; p_phone: string; p_secondary: string; p_email: string }; Returns: Json;
      };
      read_lead_cards: { Args: { p_org: string; p_id: string }; Returns: Json };
      read_customer_master: {
        Args: { p_org: string; p_query?: Json; p_id?: string };
        Returns: Json;
      };
      command_customer_master: {
        Args: { p_org: string; p_action: string; p_key: string; p_input: Json };
        Returns: Json;
      };
      read_lead_management: {
        Args: { p_org: string; p_query?: Json; p_id?: string };
        Returns: Json;
      };
      command_lead_management: {
        Args: { p_org: string; p_action: string; p_key: string; p_input: Json };
        Returns: Json;
      };
      read_sales_field: {
        Args: { p_org: string; p_kind: string; p_offset?: number };
        Returns: Json;
      };
      run_sales_field: {
        Args: { p_org: string; p_kind: string; p_action: string; p_key: string; p_data: Json };
        Returns: Json;
      };
      change_crm_record_share: {
        Args: {
          p_action: string
          p_expires_at: string | null
          p_key: string
          p_org: string
          p_recipient: string
          p_resource: string
        }
        Returns: string
      }
      change_staff_role: {
        Args: { p_action: string; p_key: string; p_member: string; p_org: string; p_role: string }
        Returns: string
      }
      change_staff_scope: {
        Args: {
          p_action: string
          p_key: string
          p_org: string
          p_subject: string
          p_target: string | null
        }
        Returns: string
      }
      create_intake_record: {
        Args: { p_input: Json; p_key: string; p_kind: string; p_org: string }
        Returns: string
      }
      crm_record_files: {
        Args: { p_offset: number; p_org: string; p_resource: string }
        Returns: Array<{ created_at: string; file_name: string; id: string; status: string }>
      }
      deactivate_staff: {
        Args: { p_key: string; p_member: string; p_org: string }
        Returns: string
      }
      file_worker_lookup: {
        Args: { p_download: boolean; p_session: string; p_stage: string; p_user: string }
        Returns: Json
      }
      file_worker_transition: {
        Args: {
          p_action: string
          p_hash: string
          p_lease: string | null
          p_scanner: string | null
          p_session: string
          p_stage: string
          p_user: string
          p_verdict: string | null
        }
        Returns: string
      }
      offboard_staff: {
        Args: { p_key: string; p_member: string; p_org: string; p_successor: string }
        Returns: string
      }
      progress_lead: {
        Args: {
          p_action: string
          p_id: string
          p_input: Json
          p_key: string
          p_org: string
          p_version: number
        }
        Returns: string
      }
      read_operating_policy_settings: {
        Args: { p_org: string }
        Returns: Json
      }
      publish_operating_policy_settings: {
        Args: {
          p_org: string
          p_section: string
          p_expected: string | null
          p_effective_on: string
          p_settings: Json
          p_key: string
        }
        Returns: string
      }
      reserve_file_stage: {
        Args: {
          p_key: string
          p_mime: string
          p_name: string
          p_org: string
          p_parent: string
          p_purpose: string
          p_size: number
        }
        Returns: string
      }
      staff_directory: {
        Args: { p_org: string }
        Returns: Array<{
          can_deactivate: boolean
          display_name: string
          membership_id: string
          status: string
        }>
      }
      update_opportunity_pipeline: {
        Args: {
          p_amount: string
          p_id: string
          p_key: string
          p_org: string
          p_probability: number
          p_reason: string
          p_stage: string
          p_version: number
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
