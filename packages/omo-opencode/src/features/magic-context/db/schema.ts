/**
 * DDL for all Magic Context storage tables.
 *
 * Every CREATE uses IF NOT EXISTS so the migration runner is
 * idempotent. Indexes, virtual tables, and triggers are also
 * guarded with IF NOT EXISTS.
 *
 * Ported from MC's storage-db.ts initializeDatabase().
 * Schema version 1 — the initial MaTrix port.
 */

export const SCHEMA_VERSION = 1

export const SCHEMA_DDL = `

-- ── Schema migrations tracker ─────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  applied_at INTEGER NOT NULL
);

-- ── Session meta ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_meta (
  session_id TEXT PRIMARY KEY,
  harness TEXT NOT NULL DEFAULT 'opencode',
  last_response_time INTEGER,
  cache_ttl TEXT,
  counter INTEGER DEFAULT 0,
  last_nudge_tokens INTEGER DEFAULT 0,
  last_nudge_band TEXT DEFAULT '',
  last_nudge_undropped INTEGER DEFAULT 0,
  last_nudge_level TEXT DEFAULT '',
  channel2_nudge_state TEXT DEFAULT '',
  channel2_nudge_claimed_at INTEGER DEFAULT 0,
  channel2_nudge_claim_token TEXT DEFAULT '',
  last_emergency_input_sample INTEGER DEFAULT 0,
  last_transform_error TEXT DEFAULT '',
  nudge_anchor_message_id TEXT DEFAULT '',
  nudge_anchor_text TEXT DEFAULT '',
  sticky_turn_reminder_text TEXT DEFAULT '',
  sticky_turn_reminder_message_id TEXT DEFAULT '',
  note_nudge_trigger_pending INTEGER DEFAULT 0,
  note_nudge_trigger_message_id TEXT DEFAULT '',
  note_nudge_sticky_text TEXT DEFAULT '',
  note_nudge_sticky_message_id TEXT DEFAULT '',
  note_nudge_anchors TEXT NOT NULL DEFAULT '[]',
  auto_search_hint_decisions TEXT NOT NULL DEFAULT '[]',
  last_todo_state TEXT DEFAULT '',
  todo_synthetic_call_id TEXT DEFAULT '',
  todo_synthetic_anchor_message_id TEXT DEFAULT '',
  todo_synthetic_state_json TEXT DEFAULT '',
  is_subagent INTEGER DEFAULT 0,
  last_context_percentage REAL DEFAULT 0,
  last_input_tokens INTEGER DEFAULT 0,
  observed_safe_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_alert_sent INTEGER NOT NULL DEFAULT 0,
  times_execute_threshold_reached INTEGER DEFAULT 0,
  compartment_in_progress INTEGER DEFAULT 0,
  historian_failure_count INTEGER DEFAULT 0,
  historian_last_error TEXT DEFAULT NULL,
  historian_last_failure_at INTEGER DEFAULT NULL,
  system_prompt_hash TEXT DEFAULT '',
  memory_block_cache TEXT DEFAULT '',
  memory_block_count INTEGER DEFAULT 0,
  memory_block_ids TEXT DEFAULT '',
  pending_compaction_marker_state TEXT,
  compaction_marker_target_end_message_id TEXT,
  pending_pi_compaction_marker_state TEXT,
  new_work_tokens INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  deferred_execute_state TEXT,
  cached_m0_bytes BLOB,
  cached_m0_project_memory_epoch INTEGER,
  cached_m0_workspace_fingerprint TEXT,
  cached_m0_project_user_profile_version INTEGER,
  cached_m0_max_compartment_seq INTEGER,
  cached_m0_max_memory_id INTEGER,
  cached_m0_max_mutation_id INTEGER,
  cached_m0_max_memory_mutation_id INTEGER,
  cached_m0_project_docs_hash TEXT,
  cached_m0_materialized_at INTEGER,
  cached_m0_session_facts_version INTEGER,
  cached_m0_upgrade_state TEXT,
  cached_m0_system_hash TEXT,
  cached_m0_tool_set_hash TEXT,
  cached_m0_model_key TEXT,
  cached_m0_project_identity TEXT,
  cached_m0_last_baseline_end_message_id TEXT,
  cached_m1_bytes BLOB,
  last_observed_model_key TEXT,
  last_usage_context_limit INTEGER NOT NULL DEFAULT 0,
  prior_boundary_ordinal INTEGER NOT NULL DEFAULT 1,
  protected_tail_policy_version INTEGER NOT NULL DEFAULT 0,
  protected_tail_drain_window_started_at INTEGER NOT NULL DEFAULT 0,
  protected_tail_drain_tokens INTEGER NOT NULL DEFAULT 0,
  recovery_no_eligible_head_count INTEGER NOT NULL DEFAULT 0,
  force_emergency_bypass_window_start INTEGER NOT NULL DEFAULT 0,
  force_emergency_bypass_used INTEGER NOT NULL DEFAULT 0,
  emergency_drain_active INTEGER NOT NULL DEFAULT 0,
  historian_drain_failure_at INTEGER NOT NULL DEFAULT 0,
  wrapup_in_progress_state TEXT,
  upgrade_reminded_at INTEGER,
  pi_stable_id_scheme INTEGER
);

-- ── Tags ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  message_id TEXT,
  type TEXT,
  status TEXT DEFAULT 'active',
  byte_size INTEGER,
  tag_number INTEGER,
  harness TEXT NOT NULL DEFAULT 'opencode',
  entry_fingerprint TEXT,
  token_count INTEGER,
  input_token_count INTEGER,
  reasoning_token_count INTEGER,
  reasoning_byte_size INTEGER DEFAULT 0,
  drop_mode TEXT DEFAULT 'full',
  tool_name TEXT,
  input_byte_size INTEGER DEFAULT 0,
  caveman_depth INTEGER DEFAULT 0,
  tool_owner_message_id TEXT DEFAULT NULL,
  UNIQUE(session_id, tag_number)
);
CREATE INDEX IF NOT EXISTS idx_tags_session ON tags(session_id);
CREATE INDEX IF NOT EXISTS idx_tags_session_tag_number ON tags(session_id, tag_number);
CREATE INDEX IF NOT EXISTS idx_tags_session_message_id ON tags(session_id, message_id);
CREATE INDEX IF NOT EXISTS idx_tags_active_session_tag_number ON tags(session_id, tag_number) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tags_dropped_session_tag_number ON tags(session_id, tag_number) WHERE status = 'dropped';
CREATE INDEX IF NOT EXISTS idx_tags_tool_composite ON tags(session_id, message_id, tool_owner_message_id) WHERE type = 'tool' AND tool_owner_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tags_tool_null_owner ON tags(session_id, message_id) WHERE type = 'tool' AND tool_owner_message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tags_pi_adopt ON tags(session_id, entry_fingerprint) WHERE type='message' AND entry_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tags_pi_fallback_tool_owner ON tags(session_id, tool_owner_message_id) WHERE type='tool';

-- ── Pending ops ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  tag_id INTEGER,
  operation TEXT,
  queued_at INTEGER,
  harness TEXT NOT NULL DEFAULT 'opencode'
);
CREATE INDEX IF NOT EXISTS idx_pending_ops_session ON pending_ops(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_ops_session_tag_id ON pending_ops(session_id, tag_id);

-- ── Source contents ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_contents (
  tag_id INTEGER,
  session_id TEXT,
  content TEXT,
  created_at INTEGER,
  harness TEXT NOT NULL DEFAULT 'opencode',
  PRIMARY KEY(session_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_source_contents_session ON source_contents(session_id);

-- ── Compartments ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compartments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  start_message INTEGER NOT NULL,
  end_message INTEGER NOT NULL,
  start_message_id TEXT DEFAULT '',
  end_message_id TEXT DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  p1 TEXT,
  p2 TEXT,
  p3 TEXT,
  p4 TEXT,
  importance INTEGER NOT NULL DEFAULT 50,
  episode_type TEXT,
  p1_embedding BLOB,
  p1_embedding_model_id TEXT,
  legacy INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode',
  UNIQUE(session_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_compartments_session ON compartments(session_id);

-- ── Compartment chunk embeddings ──────────────────────────────

CREATE TABLE IF NOT EXISTS compartment_chunk_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compartment_id INTEGER NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode',
  window_index INTEGER NOT NULL DEFAULT 0,
  start_ordinal INTEGER NOT NULL,
  end_ordinal INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(compartment_id, model_id, window_index)
);
CREATE INDEX IF NOT EXISTS idx_cce_session ON compartment_chunk_embeddings(session_id);
CREATE INDEX IF NOT EXISTS idx_cce_project_model ON compartment_chunk_embeddings(project_path, model_id);

-- ── Compartment events ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compartment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  compartment_id INTEGER,
  kind TEXT NOT NULL,
  at_compartment INTEGER,
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode'
);
CREATE INDEX IF NOT EXISTS idx_compartment_events_session ON compartment_events(session_id);

-- ── Compartment state lease ──────────────────────────────────

CREATE TABLE IF NOT EXISTS compartment_state_lease (
  session_id TEXT PRIMARY KEY NOT NULL,
  holder_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compartment_state_lease_expires ON compartment_state_lease(expires_at);

-- ── Compression depth ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compression_depth (
  session_id TEXT NOT NULL,
  message_ordinal INTEGER NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  harness TEXT NOT NULL DEFAULT 'opencode',
  PRIMARY KEY(session_id, message_ordinal)
);
CREATE INDEX IF NOT EXISTS idx_compression_depth_session ON compression_depth(session_id);

-- ── Session facts ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode'
);
CREATE INDEX IF NOT EXISTS idx_session_facts_session ON session_facts(session_id);

-- ── Primer candidates ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS primer_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode',
  session_id TEXT NOT NULL,
  question TEXT NOT NULL,
  normalized_question TEXT NOT NULL,
  source_compartment_start INTEGER,
  source_compartment_end INTEGER,
  source_start_message_id TEXT NOT NULL DEFAULT '',
  source_end_message_id TEXT NOT NULL DEFAULT '',
  source_message_time INTEGER NOT NULL,
  question_embedding BLOB,
  question_embedding_model_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(project_path, harness, session_id, source_start_message_id, source_end_message_id)
);
CREATE INDEX IF NOT EXISTS idx_primer_candidates_project_time ON primer_candidates(project_path, source_message_time);
CREATE INDEX IF NOT EXISTS idx_primer_candidates_session ON primer_candidates(session_id, harness);
CREATE INDEX IF NOT EXISTS idx_primer_candidates_embedding_model ON primer_candidates(project_path, question_embedding_model_id);

-- ── Primers ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS primers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  question TEXT NOT NULL,
  question_embedding BLOB,
  question_embedding_model_id TEXT,
  answer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  total_support INTEGER NOT NULL DEFAULT 0,
  last_observed_at INTEGER,
  answer_refreshed_at INTEGER,
  source_candidate_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_primers_project_status_observed ON primers(project_path, status, last_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_primers_embedding_model ON primers(project_path, question_embedding_model_id);

CREATE VIRTUAL TABLE IF NOT EXISTS primers_fts USING fts5(
  question, answer, project_path UNINDEXED,
  content='primers', content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS primers_ai AFTER INSERT ON primers BEGIN
  INSERT INTO primers_fts(rowid, question, answer, project_path)
  VALUES (new.id, new.question, new.answer, new.project_path);
END;

CREATE TRIGGER IF NOT EXISTS primers_ad AFTER DELETE ON primers BEGIN
  INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
  VALUES ('delete', old.id, old.question, old.answer, old.project_path);
END;

CREATE TRIGGER IF NOT EXISTS primers_au AFTER UPDATE ON primers BEGIN
  INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
  VALUES ('delete', old.id, old.question, old.answer, old.project_path);
  INSERT INTO primers_fts(rowid, question, answer, project_path)
  VALUES (new.id, new.question, new.answer, new.project_path);
END;

-- ── Memories ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  importance INTEGER,
  scope TEXT NOT NULL DEFAULT 'project',
  shareable INTEGER NOT NULL DEFAULT 0,
  source_session_id TEXT,
  source_type TEXT DEFAULT 'historian',
  seen_count INTEGER DEFAULT 1,
  retrieval_count INTEGER DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_retrieved_at INTEGER,
  status TEXT DEFAULT 'active',
  expires_at INTEGER,
  verification_status TEXT DEFAULT 'unverified',
  verified_at INTEGER,
  classified_at INTEGER,
  superseded_by_memory_id INTEGER,
  merged_from TEXT,
  metadata_json TEXT,
  UNIQUE(project_path, category, normalized_hash)
);
CREATE INDEX IF NOT EXISTS idx_memories_project_status_category ON memories(project_path, status, category);
CREATE INDEX IF NOT EXISTS idx_memories_project_status_expires ON memories(project_path, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_project_category_hash ON memories(project_path, category, normalized_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, category,
  content='memories', content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.id, old.content, old.category);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.id, old.content, old.category);
  INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
END;

-- ── Memory embeddings ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model_id TEXT NOT NULL,
  PRIMARY KEY(memory_id, model_id)
);

-- ── Embedding identity active ────────────────────────────────

CREATE TABLE IF NOT EXISTS embedding_identity_active (
  project_path TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('memory', 'commit', 'chunk')),
  model_id TEXT NOT NULL,
  last_active_at INTEGER NOT NULL,
  PRIMARY KEY(project_path, scope, model_id)
);

-- ── Memory verifications ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_verifications (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  mapped_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (memory_id, file_path)
);
CREATE INDEX IF NOT EXISTS idx_memory_verifications_memory ON memory_verifications(memory_id);

-- ── Memory mutation log ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_mutation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  mutation_type TEXT NOT NULL CHECK (mutation_type IN ('archive', 'delete', 'update', 'superseded')),
  target_memory_id INTEGER NOT NULL,
  superseded_by_id INTEGER,
  category TEXT,
  new_content TEXT,
  queued_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_project ON memory_mutation_log(project_path, id);

-- ── Dream state (KV store) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS dream_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── Dream queue ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dream_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  started_at INTEGER,
  retry_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dream_queue_project ON dream_queue(project_path);
CREATE INDEX IF NOT EXISTS idx_dream_queue_pending ON dream_queue(started_at, enqueued_at);

-- ── Dream runs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dream_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  holder_id TEXT NOT NULL,
  tasks_json TEXT NOT NULL,
  tasks_succeeded INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  smart_notes_surfaced INTEGER NOT NULL DEFAULT 0,
  smart_notes_pending INTEGER NOT NULL DEFAULT 0,
  memory_changes_json TEXT,
  parent_session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_dream_runs_project ON dream_runs(project_path, finished_at DESC);

-- ── Task schedule state ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_schedule_state (
  project_path TEXT NOT NULL,
  task TEXT NOT NULL,
  last_run_at INTEGER,
  next_due_at INTEGER,
  schedule TEXT,
  last_status TEXT,
  last_error TEXT,
  last_checked_commit TEXT,
  last_broad_run_at INTEGER,
  retrospective_watermark_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_path, task)
);
CREATE INDEX IF NOT EXISTS idx_task_schedule_due ON task_schedule_state(next_due_at);

-- ── Retrospective processed windows ──────────────────────────

CREATE TABLE IF NOT EXISTS retrospective_processed_windows (
  project_path TEXT NOT NULL,
  window_key TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (project_path, window_key)
);

-- ── Historian runs ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS historian_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode',
  subagent_invocation_id INTEGER,
  run_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_reason TEXT,
  chunk_start_ordinal INTEGER,
  chunk_end_ordinal INTEGER,
  unprocessed_from INTEGER,
  compartments_produced INTEGER NOT NULL DEFAULT 0,
  compartment_id_min INTEGER,
  compartment_id_max INTEGER,
  facts_emitted INTEGER NOT NULL DEFAULT 0,
  facts_by_category_json TEXT,
  events_emitted INTEGER NOT NULL DEFAULT 0,
  importance_min INTEGER,
  importance_max INTEGER,
  importance_avg REAL,
  discarded_last INTEGER NOT NULL DEFAULT 0,
  legacy INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_historian_runs_session ON historian_runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historian_runs_status ON historian_runs(status, created_at DESC);

-- ── Message history index ────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_history_index (
  session_id TEXT PRIMARY KEY,
  last_indexed_ordinal INTEGER NOT NULL DEFAULT 0,
  dirty_floor_ordinal INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode'
);
CREATE INDEX IF NOT EXISTS idx_message_history_index_updated_at ON message_history_index(updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS message_history_fts USING fts5(
  session_id UNINDEXED, message_ordinal UNINDEXED, message_id UNINDEXED, role, content,
  tokenize='porter unicode61'
);

-- ── Notes ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'session',
  status TEXT NOT NULL DEFAULT 'active',
  content TEXT NOT NULL,
  session_id TEXT,
  project_path TEXT,
  surface_condition TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_checked_at INTEGER,
  ready_at INTEGER,
  ready_reason TEXT,
  harness TEXT NOT NULL DEFAULT 'opencode',
  anchor_ordinal INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notes_session_status ON notes(session_id, status);
CREATE INDEX IF NOT EXISTS idx_notes_project_status ON notes(project_path, status);
CREATE INDEX IF NOT EXISTS idx_notes_type_status ON notes(type, status);

-- ── Git commits ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS git_commits (
  sha TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  short_sha TEXT NOT NULL,
  message TEXT NOT NULL,
  author TEXT,
  committed_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_git_commits_project_time ON git_commits(project_path, committed_at DESC);

CREATE TABLE IF NOT EXISTS git_commit_embeddings (
  sha TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(sha) REFERENCES git_commits(sha) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS git_commits_fts USING fts5(
  sha UNINDEXED, project_path UNINDEXED, message,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS git_commits_fts_insert AFTER INSERT ON git_commits BEGIN
  DELETE FROM git_commits_fts WHERE sha = NEW.sha;
  INSERT INTO git_commits_fts(sha, project_path, message) VALUES (NEW.sha, NEW.project_path, NEW.message);
END;

CREATE TRIGGER IF NOT EXISTS git_commits_fts_delete AFTER DELETE ON git_commits BEGIN
  DELETE FROM git_commits_fts WHERE sha = OLD.sha;
END;

CREATE TRIGGER IF NOT EXISTS git_commits_fts_update AFTER UPDATE OF message, project_path ON git_commits BEGIN
  DELETE FROM git_commits_fts WHERE sha = OLD.sha;
  INSERT INTO git_commits_fts(sha, project_path, message) VALUES (NEW.sha, NEW.project_path, NEW.message);
END;

-- ── Git sweep coordinator ────────────────────────────────────

CREATE TABLE IF NOT EXISTS git_sweep_coordinator (
  project_path TEXT PRIMARY KEY,
  lease_holder TEXT,
  lease_expires_at INTEGER,
  last_swept_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_git_sweep_coordinator_lease_expires ON git_sweep_coordinator(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_git_sweep_coordinator_last_swept ON git_sweep_coordinator(last_swept_at);

-- ── Project state ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_state (
  project_path TEXT PRIMARY KEY,
  project_memory_epoch INTEGER NOT NULL DEFAULT 0,
  project_user_profile_version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- ── Project key files ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_key_files (
  project_path TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  local_token_estimate INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  generated_by_model TEXT,
  generation_config_hash TEXT NOT NULL,
  stale_reason TEXT,
  PRIMARY KEY (project_path, path)
);
CREATE INDEX IF NOT EXISTS idx_project_key_files_project ON project_key_files(project_path);
CREATE INDEX IF NOT EXISTS idx_project_key_files_generated_at ON project_key_files(project_path, generated_at);

CREATE TABLE IF NOT EXISTS project_key_files_version (
  project_path TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0
);

-- ── Session projects ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_projects (
  session_id TEXT NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode',
  project_path TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, harness)
);
CREATE INDEX IF NOT EXISTS idx_session_projects_project ON session_projects(project_path);

-- ── Workspaces + members ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  share_categories TEXT NOT NULL DEFAULT '["CONSTRAINTS"]'
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  display_path TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, project_path)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_unique ON workspace_members(project_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_name ON workspace_members(workspace_id, display_name);

-- ── Subagent invocations ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS subagent_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  harness TEXT NOT NULL,
  subagent TEXT NOT NULL,
  task TEXT,
  provider_id TEXT,
  model_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  parent_invocation_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sai_session_started ON subagent_invocations(session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sai_subagent ON subagent_invocations(subagent, started_at DESC);

-- ── m0 mutation log ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS m0_mutation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  mutation_type TEXT NOT NULL CHECK (mutation_type IN (
    'compartment_delete', 'compartment_merge', 'recomp_boundary_change', 'compartment_upgrade'
  )),
  target_id INTEGER,
  queued_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_m0_mutation_log_session ON m0_mutation_log(session_id);

-- ── v22 identity rekey map ────────────────────────────────────

CREATE TABLE IF NOT EXISTS v22_identity_rekey_map (
  old_project_path TEXT PRIMARY KEY,
  new_project_path TEXT NOT NULL,
  rekeyed_at INTEGER NOT NULL
);

-- ── v22 backfill failures ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS v22_backfill_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  raw_project_path TEXT NOT NULL,
  error_class TEXT NOT NULL CHECK (error_class IN (
    'not_git_repo', 'git_missing', 'git_timeout', 'permission_denied', 'unknown'
  )),
  error_message TEXT,
  failed_at INTEGER NOT NULL,
  UNIQUE(table_name, row_id)
);

-- ── Transform decisions ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS transform_decisions (
  session_id TEXT NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode',
  message_id TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  decision TEXT NOT NULL,
  materialized INTEGER NOT NULL DEFAULT 0,
  materialize_reason TEXT,
  emergency INTEGER NOT NULL DEFAULT 0,
  dropped_tokens INTEGER NOT NULL DEFAULT 0,
  dropped_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, harness, message_id)
);
CREATE INDEX IF NOT EXISTS idx_transform_decisions_session_harness ON transform_decisions(session_id, harness);

-- ── Recomp staging ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recomp_compartments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  start_message INTEGER NOT NULL,
  end_message INTEGER NOT NULL,
  start_message_id TEXT DEFAULT '',
  end_message_id TEXT DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  p1 TEXT,
  p2 TEXT,
  p3 TEXT,
  p4 TEXT,
  importance INTEGER NOT NULL DEFAULT 50,
  episode_type TEXT,
  pass_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode',
  UNIQUE(session_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_recomp_compartments_session ON recomp_compartments(session_id);

CREATE TABLE IF NOT EXISTS recomp_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  pass_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  harness TEXT NOT NULL DEFAULT 'opencode'
);
CREATE INDEX IF NOT EXISTS idx_recomp_facts_session ON recomp_facts(session_id);

-- ── Schema migrations meta (KV for boot-time metadata) ───────

CREATE TABLE IF NOT EXISTS schema_migrations_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

`.trim()
