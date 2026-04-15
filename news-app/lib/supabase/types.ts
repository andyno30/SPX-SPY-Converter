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
          original_url: string;
          source: string;
          source_type: string;
          published_at: string;
          tickers: string[];
          fetched_at: string;
        };
        Insert: {
          id?: number;
          title: string;
          summary?: string | null;
          original_url: string;
          source: string;
          source_type: string;
          published_at: string;
          tickers?: string[];
          fetched_at?: string;
        };
        Update: {
          id?: number;
          title?: string;
          summary?: string | null;
          original_url?: string;
          source?: string;
          source_type?: string;
          published_at?: string;
          tickers?: string[];
          fetched_at?: string;
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
