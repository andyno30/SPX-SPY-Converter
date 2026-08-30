export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      news_articles: {
        Row: {
          id: number;
          title: string;
          summary: string | null;
          original_url: string | null;
          external_id: string | null;
          source: string;
          source_type: string;
          published_at: string;
          tickers: string[];
          headline_only: boolean;
          fetched_at: string;
        };
        Insert: {
          id?: number;
          title: string;
          summary?: string | null;
          original_url?: string | null;
          external_id?: string | null;
          source: string;
          source_type: string;
          published_at: string;
          tickers?: string[];
          headline_only?: boolean;
          fetched_at?: string;
        };
        Update: {
          id?: number;
          title?: string;
          summary?: string | null;
          original_url?: string | null;
          external_id?: string | null;
          source?: string;
          source_type?: string;
          published_at?: string;
          tickers?: string[];
          headline_only?: boolean;
          fetched_at?: string;
        };
        Relationships: [];
      };
      news_comments: {
        Row: {
          id: number;
          article_id: number;
          user_id: string;
          display_name: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          article_id: number;
          user_id: string;
          display_name: string;
          body: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          body?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      news_reactions: {
        Row: {
          article_id: number;
          user_id: string;
          reaction: "bullish" | "bearish";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          article_id: number;
          user_id: string;
          reaction: "bullish" | "bearish";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          reaction?: "bullish" | "bearish";
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type NewsArticleRow = Database["public"]["Tables"]["news_articles"]["Row"];
