// packages/core/src/db/schema.ts

/**
 * Represents a row in the `files` table.
 * Created by migration: 001_initial.sql (Milestone 1)
 */
export interface FileRow {
  id: number;
  path: string;
  relative_path: string;
  language: string;
  content_hash: string;
  last_scanned: number;
  has_errors: 0 | 1;
}

/**
 * Represents a row in the `symbols` table.
 * Created by migration: 001_initial.sql (Milestone 1)
 */
export interface SymbolRow {
  id: number;
  name: string;
  qualified_name: string;
  kind: string;
  file_id: number;
  line_start: number;
  line_end: number;
  col_start: number;
  col_end: number;
  is_exported: 0 | 1;
  is_default_export: 0 | 1;
  parent_name: string | null;
  parameters: string;       // JSON string — parse with JSON.parse()
  meta: string;             // JSON string — parse with JSON.parse()
}

/**
 * Represents a row in the `imports` table.
 * Created by migration: 001_initial.sql (Milestone 1)
 */
export interface ImportRow {
  id: number;
  from_file_id: number;
  to_file_id: number | null;
  specifier: string;
  resolved_path: string | null;
  is_external: 0 | 1;
  kind: string;
  imported_names: string;   // JSON string
  local_alias: string | null;
}

/**
 * Represents a row in the `exports` table.
 * Created by migration: 001_initial.sql (Milestone 1)
 */
export interface ExportRow {
  id: number;
  file_id: number;
  symbol_id: number | null;
  exported_name: string;
  local_name: string | null;
  is_default: 0 | 1;
  is_re_export: 0 | 1;
  re_export_specifier: string | null;
}

/**
 * Represents a row in the `calls` table.
 * Created by migration: 002_calls.sql (Milestone 2)
 */
export interface CallRow {
  id: number;
  caller_symbol_id: number;
  callee_symbol_id: number | null;
  callee_raw_name: string;
  resolution_status: 'resolved' | 'unresolved' | 'external' | 'dynamic';
  file_id: number;
  line_number: number;
  col_number: number;
}

/**
 * Represents a row in the `scan_sessions` table.
 * Created by migration: 003_incremental.sql (Milestone 3)
 */
export interface ScanSessionRow {
  id: number;
  project_root: string;
  started_at: number;
  completed_at: number | null;
  status: 'running' | 'complete' | 'failed';
  files_scanned: number;
  files_skipped: number;
  symbols_found: number;
  edges_found: number;
  error_message: string | null;
}

/**
 * Represents a row in the `executions` table.
 * Created by migration: 004_runtime.sql (Milestone 7)
 */
export interface ExecutionRow {
  id: number;
  symbol_id: number;
  record_session_id: number;
  call_count: number;
  total_duration_ms: number;
  min_duration_ms: number | null;
  max_duration_ms: number | null;
  first_seen: number;
  last_seen: number;
}

/**
 * Represents a row in the `routes` table.
 * Created by migration: 005_routes.sql (Milestone 2)
 */
export interface RouteRow {
  id: number;
  symbol_id: number;
  method: string;
  path_pattern: string;
  file_id: number;
  line_number: number;
}

