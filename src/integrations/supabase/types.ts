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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      companion_token_offers: {
        Row: {
          amount_base_units: string
          created_at: string
          id: string
          listing_id: string
          note: string | null
          price_wei_per_token: string
          seller_wallet: string
          status: string
          token_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_base_units: string
          created_at?: string
          id?: string
          listing_id: string
          note?: string | null
          price_wei_per_token: string
          seller_wallet: string
          status?: string
          token_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_base_units?: string
          created_at?: string
          id?: string
          listing_id?: string
          note?: string | null
          price_wei_per_token?: string
          seller_wallet?: string
          status?: string
          token_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_token_offers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_token_offers_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "companion_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_tokens: {
        Row: {
          block_number: number | null
          bytecode_hash: string | null
          chain_id: number
          confirmed_at: string | null
          created_at: string
          creator_allocation: string
          disclaimer_accepted_at: string
          factory_address: string
          failure_reason: string | null
          id: string
          implementation_address: string | null
          last_reconciled_at: string | null
          listing_id: string
          name: string
          passport_id: string
          status: string
          submitted_at: string | null
          symbol: string
          token_address: string | null
          total_supply: string
          tx_hash: string | null
          updated_at: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          block_number?: number | null
          bytecode_hash?: string | null
          chain_id: number
          confirmed_at?: string | null
          created_at?: string
          creator_allocation: string
          disclaimer_accepted_at?: string
          factory_address: string
          failure_reason?: string | null
          id?: string
          implementation_address?: string | null
          last_reconciled_at?: string | null
          listing_id: string
          name: string
          passport_id: string
          status?: string
          submitted_at?: string | null
          symbol: string
          token_address?: string | null
          total_supply: string
          tx_hash?: string | null
          updated_at?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          block_number?: number | null
          bytecode_hash?: string | null
          chain_id?: number
          confirmed_at?: string | null
          created_at?: string
          creator_allocation?: string
          disclaimer_accepted_at?: string
          factory_address?: string
          failure_reason?: string | null
          id?: string
          implementation_address?: string | null
          last_reconciled_at?: string | null
          listing_id?: string
          name?: string
          passport_id?: string
          status?: string
          submitted_at?: string | null
          symbol?: string
          token_address?: string | null
          total_supply?: string
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_tokens_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_tokens_passport_id_fkey"
            columns: ["passport_id"]
            isOneToOne: true
            referencedRelation: "item_passports"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      item_passports: {
        Row: {
          attestation: Json | null
          block_number: number | null
          chain_id: number
          confirmed_at: string | null
          contract_address: string
          created_at: string
          failure_reason: string | null
          id: string
          image_hashes: Json
          ipfs_cid: string | null
          ipfs_pinned_at: string | null
          last_reconciled_at: string | null
          listing_id: string
          listing_key: string
          metadata_hash: string
          metadata_snapshot: Json
          metadata_uri: string
          status: string
          storage_url: string | null
          submitted_at: string | null
          terms_hash: string
          token_id: number | null
          tx_hash: string | null
          updated_at: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          attestation?: Json | null
          block_number?: number | null
          chain_id: number
          confirmed_at?: string | null
          contract_address: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          image_hashes?: Json
          ipfs_cid?: string | null
          ipfs_pinned_at?: string | null
          last_reconciled_at?: string | null
          listing_id: string
          listing_key: string
          metadata_hash: string
          metadata_snapshot?: Json
          metadata_uri: string
          status?: string
          storage_url?: string | null
          submitted_at?: string | null
          terms_hash: string
          token_id?: number | null
          tx_hash?: string | null
          updated_at?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          attestation?: Json | null
          block_number?: number | null
          chain_id?: number
          confirmed_at?: string | null
          contract_address?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          image_hashes?: Json
          ipfs_cid?: string | null
          ipfs_pinned_at?: string | null
          last_reconciled_at?: string | null
          listing_id?: string
          listing_key?: string
          metadata_hash?: string
          metadata_snapshot?: Json
          metadata_uri?: string
          status?: string
          storage_url?: string | null
          submitted_at?: string | null
          terms_hash?: string
          token_id?: number | null
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_passports_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      liquidity_positions: {
        Row: {
          amount0_min: string
          amount1_min: string
          chain_id: number
          confirmed_at: string | null
          created_at: string
          deadline_seconds: number
          eth_amount: string
          factory_address: string
          failure_reason: string | null
          fee_tier: number
          id: string
          liquidity: string | null
          listing_id: string
          mint_tx_hash: string | null
          pool_address: string | null
          pool_tx_hash: string | null
          position_manager: string
          position_token_id: string | null
          risk_accepted_at: string
          slippage_bps: number
          sqrt_price_x96: string
          status: string
          step: string
          tick_lower: number
          tick_upper: number
          token_address: string
          token_amount: string
          token_approve_tx_hash: string | null
          token_id: string
          token0: string
          token1: string
          updated_at: string
          user_id: string
          wallet_address: string
          weth_address: string
          weth_approve_tx_hash: string | null
          wrap_tx_hash: string | null
        }
        Insert: {
          amount0_min: string
          amount1_min: string
          chain_id: number
          confirmed_at?: string | null
          created_at?: string
          deadline_seconds?: number
          eth_amount: string
          factory_address: string
          failure_reason?: string | null
          fee_tier?: number
          id?: string
          liquidity?: string | null
          listing_id: string
          mint_tx_hash?: string | null
          pool_address?: string | null
          pool_tx_hash?: string | null
          position_manager: string
          position_token_id?: string | null
          risk_accepted_at: string
          slippage_bps?: number
          sqrt_price_x96: string
          status?: string
          step?: string
          tick_lower: number
          tick_upper: number
          token_address: string
          token_amount: string
          token_approve_tx_hash?: string | null
          token_id: string
          token0: string
          token1: string
          updated_at?: string
          user_id: string
          wallet_address: string
          weth_address: string
          weth_approve_tx_hash?: string | null
          wrap_tx_hash?: string | null
        }
        Update: {
          amount0_min?: string
          amount1_min?: string
          chain_id?: number
          confirmed_at?: string | null
          created_at?: string
          deadline_seconds?: number
          eth_amount?: string
          factory_address?: string
          failure_reason?: string | null
          fee_tier?: number
          id?: string
          liquidity?: string | null
          listing_id?: string
          mint_tx_hash?: string | null
          pool_address?: string | null
          pool_tx_hash?: string | null
          position_manager?: string
          position_token_id?: string | null
          risk_accepted_at?: string
          slippage_bps?: number
          sqrt_price_x96?: string
          status?: string
          step?: string
          tick_lower?: number
          tick_upper?: number
          token_address?: string
          token_amount?: string
          token_approve_tx_hash?: string | null
          token_id?: string
          token0?: string
          token1?: string
          updated_at?: string
          user_id?: string
          wallet_address?: string
          weth_address?: string
          weth_approve_tx_hash?: string | null
          wrap_tx_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "liquidity_positions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liquidity_positions_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: true
            referencedRelation: "companion_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_media: {
        Row: {
          content_hash: string | null
          created_at: string
          height: number | null
          id: string
          is_cover: boolean
          listing_id: string
          moderation_state: Database["public"]["Enums"]["media_moderation_state"]
          ordinal: number
          public_url: string | null
          storage_path: string | null
          width: number | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          height?: number | null
          id?: string
          is_cover?: boolean
          listing_id: string
          moderation_state?: Database["public"]["Enums"]["media_moderation_state"]
          ordinal?: number
          public_url?: string | null
          storage_path?: string | null
          width?: number | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          height?: number | null
          id?: string
          is_cover?: boolean
          listing_id?: string
          moderation_state?: Database["public"]["Enums"]["media_moderation_state"]
          ordinal?: number
          public_url?: string | null
          storage_path?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_media_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          accuracy_confirmed: boolean
          attestation_accepted: boolean
          availability: string | null
          brand: string | null
          category: Database["public"]["Enums"]["listing_category"] | null
          city: string | null
          companion_token: boolean
          condition: Database["public"]["Enums"]["listing_condition"] | null
          condition_notes: string | null
          created_at: string
          demo_seller_handle: string | null
          description: string
          dimensions: string | null
          fulfillment_mode: Database["public"]["Enums"]["fulfillment_mode"]
          id: string
          is_demo: boolean
          is_free: boolean
          model: string | null
          passport_minted: boolean
          pickup_deadline: string | null
          possession_code_hash: string | null
          postal_prefix: string | null
          price_eth: number
          price_wei: number
          published_at: string | null
          region: string | null
          seller_id: string | null
          slug: string
          status: Database["public"]["Enums"]["listing_status"]
          terms_version: string | null
          title: string
          updated_at: string
          wizard_step: number
          year: number | null
        }
        Insert: {
          accuracy_confirmed?: boolean
          attestation_accepted?: boolean
          availability?: string | null
          brand?: string | null
          category?: Database["public"]["Enums"]["listing_category"] | null
          city?: string | null
          companion_token?: boolean
          condition?: Database["public"]["Enums"]["listing_condition"] | null
          condition_notes?: string | null
          created_at?: string
          demo_seller_handle?: string | null
          description?: string
          dimensions?: string | null
          fulfillment_mode?: Database["public"]["Enums"]["fulfillment_mode"]
          id?: string
          is_demo?: boolean
          is_free?: boolean
          model?: string | null
          passport_minted?: boolean
          pickup_deadline?: string | null
          possession_code_hash?: string | null
          postal_prefix?: string | null
          price_eth?: number
          price_wei?: number
          published_at?: string | null
          region?: string | null
          seller_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["listing_status"]
          terms_version?: string | null
          title?: string
          updated_at?: string
          wizard_step?: number
          year?: number | null
        }
        Update: {
          accuracy_confirmed?: boolean
          attestation_accepted?: boolean
          availability?: string | null
          brand?: string | null
          category?: Database["public"]["Enums"]["listing_category"] | null
          city?: string | null
          companion_token?: boolean
          condition?: Database["public"]["Enums"]["listing_condition"] | null
          condition_notes?: string | null
          created_at?: string
          demo_seller_handle?: string | null
          description?: string
          dimensions?: string | null
          fulfillment_mode?: Database["public"]["Enums"]["fulfillment_mode"]
          id?: string
          is_demo?: boolean
          is_free?: boolean
          model?: string | null
          passport_minted?: boolean
          pickup_deadline?: string | null
          possession_code_hash?: string | null
          postal_prefix?: string | null
          price_eth?: number
          price_wei?: number
          published_at?: string | null
          region?: string | null
          seller_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["listing_status"]
          terms_version?: string | null
          title?: string
          updated_at?: string
          wizard_step?: number
          year?: number | null
        }
        Relationships: []
      }
      moderation_actions: {
        Row: {
          action: string
          created_at: string
          id: string
          listing_id: string | null
          moderator_id: string | null
          notes: string | null
          report_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          listing_id?: string | null
          moderator_id?: string | null
          notes?: string | null
          report_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          listing_id?: string | null
          moderator_id?: string | null
          notes?: string | null
          report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          href: string | null
          id: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      private_pickup_details: {
        Row: {
          contact_note: string | null
          created_at: string
          exact_address: string | null
          instructions: string | null
          listing_id: string
          reveal_policy: string
          seller_id: string
          updated_at: string
        }
        Insert: {
          contact_note?: string | null
          created_at?: string
          exact_address?: string | null
          instructions?: string | null
          listing_id: string
          reveal_policy?: string
          seller_id: string
          updated_at?: string
        }
        Update: {
          contact_note?: string | null
          created_at?: string
          exact_address?: string | null
          instructions?: string | null
          listing_id?: string
          reveal_policy?: string
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_pickup_details_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          bio: string | null
          city: string | null
          created_at: string
          display_name: string | null
          handle: string
          id: string
          listings_published: number
          listings_sold: number
          region: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          display_name?: string | null
          handle: string
          id: string
          listings_published?: number
          listings_sold?: number
          region?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          display_name?: string | null
          handle?: string
          id?: string
          listings_published?: number
          listings_sold?: number
          region?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          listing_id: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string | null
          status: Database["public"]["Enums"]["report_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          listing_id?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          listing_id?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_versions: {
        Row: {
          body: string
          effective_from: string
          id: string
          terms_hash: string
          version: string
        }
        Insert: {
          body: string
          effective_from?: string
          id?: string
          terms_hash: string
          version: string
        }
        Update: {
          body?: string
          effective_from?: string
          id?: string
          terms_hash?: string
          version?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_nonces: {
        Row: {
          address: string | null
          chain_id: number
          consumed_at: string | null
          created_at: string
          domain: string
          expires_at: string
          id: string
          nonce_hash: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          chain_id: number
          consumed_at?: string | null
          created_at?: string
          domain: string
          expires_at: string
          id?: string
          nonce_hash: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          chain_id?: number
          consumed_at?: string | null
          created_at?: string
          domain?: string
          expires_at?: string
          id?: string
          nonce_hash?: string
          user_id?: string | null
        }
        Relationships: []
      }
      wallets: {
        Row: {
          address: string
          chain_id: number
          created_at: string
          id: string
          last_used_at: string | null
          user_id: string
          verified_at: string
        }
        Insert: {
          address: string
          chain_id: number
          created_at?: string
          id?: string
          last_used_at?: string | null
          user_id: string
          verified_at?: string
        }
        Update: {
          address?: string
          chain_id?: number
          created_at?: string
          id?: string
          last_used_at?: string | null
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "user" | "moderator" | "admin"
      fulfillment_mode: "reserve_only" | "onchain_escrow"
      listing_category:
        | "furniture"
        | "electronics"
        | "collectibles"
        | "tools"
        | "home_garden"
        | "clothing"
        | "toys_games"
        | "music"
        | "sports"
        | "free_stuff"
        | "other"
      listing_condition:
        | "new_unused"
        | "like_new"
        | "good"
        | "fair"
        | "for_parts"
      listing_status:
        | "draft"
        | "published"
        | "reserved"
        | "sold"
        | "redeemed"
        | "removed"
      media_moderation_state: "pending" | "approved" | "flagged" | "removed"
      report_reason:
        | "stolen"
        | "prohibited"
        | "counterfeit"
        | "unsafe_meetup"
        | "spam"
        | "other"
      report_status: "open" | "reviewing" | "actioned" | "dismissed"
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
    Enums: {
      app_role: ["user", "moderator", "admin"],
      fulfillment_mode: ["reserve_only", "onchain_escrow"],
      listing_category: [
        "furniture",
        "electronics",
        "collectibles",
        "tools",
        "home_garden",
        "clothing",
        "toys_games",
        "music",
        "sports",
        "free_stuff",
        "other",
      ],
      listing_condition: [
        "new_unused",
        "like_new",
        "good",
        "fair",
        "for_parts",
      ],
      listing_status: [
        "draft",
        "published",
        "reserved",
        "sold",
        "redeemed",
        "removed",
      ],
      media_moderation_state: ["pending", "approved", "flagged", "removed"],
      report_reason: [
        "stolen",
        "prohibited",
        "counterfeit",
        "unsafe_meetup",
        "spam",
        "other",
      ],
      report_status: ["open", "reviewing", "actioned", "dismissed"],
    },
  },
} as const
