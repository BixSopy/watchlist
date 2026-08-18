-- Watchlist Ciné Premium — Schéma PostgreSQL Supabase
-- Créé : Session 6-8
-- Tables : watchlist_items, profiles, keep_alive

-- ============================================================================
-- TABLE: profiles (utilisateurs)
-- ============================================================================
CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  avatar text,
  avatar_color text,
  has_pin boolean DEFAULT false,
  pin_hash text,
  is_manager boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- TABLE: watchlist_items (films, séries, anime)
-- ============================================================================
CREATE TABLE watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id text NOT NULL,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Metadata TMDB
  tmdb_id integer,
  tmdb_type text,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'todo',
  title text NOT NULL,
  year text,
  poster_path text,
  tmdb_score double precision,
  overview text,
  
  -- Notation utilisateur
  my_rating double precision,
  
  -- Tags / catégories
  tags ARRAY,
  
  -- Séries / anime
  saison integer,
  episode integer,
  total_ep integer,
  anime_genre text,
  
  -- Collections / sagas
  collection_id text,
  collection_name text,
  tmdb_collection_id integer,
  
  -- Episode tracking
  has_new_ep boolean DEFAULT false,
  next_air text,
  
  -- Soft delete + sync
  deleted boolean DEFAULT false,
  added_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Index pour perf queries
CREATE INDEX idx_watchlist_profile_id ON watchlist_items(profile_id);
CREATE INDEX idx_watchlist_status ON watchlist_items(status);
CREATE INDEX idx_watchlist_tmdb_id ON watchlist_items(tmdb_id);

-- ============================================================================
-- TABLE: keep_alive (cron Supabase — prevents project pause)
-- ============================================================================
CREATE TABLE keep_alive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pinged_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
--
