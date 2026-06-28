/**
 * gmap — Language Adapter Contract
 *
 * This file defines the canonical interfaces that every language adapter must
 * implement. Nothing above the parser layer should import language-specific
 * code. All graph construction, analysis, and API logic works exclusively
 * against these types.
 *
 * Adding a new language = implementing LanguageAdapter + registering it.
 * Zero changes required to the scanner, graph engine, or API.
 */

// ---------------------------------------------------------------------------
// 1. PRIMITIVE LOCATION TYPES
// ---------------------------------------------------------------------------

/** Zero-indexed line and column position in a source file. */
export interface Position {
  line: number;   // 0-indexed
  column: number; // 0-indexed
}

/** Inclusive start–end span within a source file. */
export interface Range {
  start: Position;
  end: Position;
}

// ---------------------------------------------------------------------------
// 2. SYMBOL TYPES
// ---------------------------------------------------------------------------

/**
 * Every extractable construct in a source file is a SymbolKind.
 * New kinds can be added here — adapters that don't support a kind
 * simply never emit it. The graph engine ignores unknown kinds gracefully.
 */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'enum'
  | 'namespace'
  | 'route'        // HTTP route handler (Express, Fastify, etc.)
  | 'model';       // Database model / schema definition

/**
 * A single named symbol extracted from a source file.
 * This is a node in the symbol graph.
 */
export interface ParsedSymbol {
  /** Unqualified name as written in source: "approveEstimate" */
  name: string;

  /** Fully qualified name including class/namespace: "ApprovalService.approveEstimate" */
  qualifiedName: string;

  kind: SymbolKind;

  /** Location of the symbol's declaration (name token) */
  location: Range;

  /** Location of the full symbol body including braces */
  bodyRange: Range;

  /** True if this symbol is part of the file's public API */
  isExported: boolean;

  /** True if this is the file's default export */
  isDefaultExport: boolean;

  /** For functions/methods: parameter names (types stripped, for display only) */
  parameters?: string[];

  /** For methods: the class or interface this belongs to */
  parentName?: string;

  /**
   * For route symbols: HTTP method and path pattern.
   * e.g. { method: 'POST', path: '/estimates/:id/approve' }
   */
  route?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL';
    path: string;
  };

  /**
   * Adapter-specific metadata that doesn't fit the canonical fields.
   * The graph engine ignores this — available for debugging and
   * future adapter-specific features only.
   */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 3. IMPORT / EXPORT TYPES
// ---------------------------------------------------------------------------

/** How a symbol or module was imported */
export type ImportKind =
  | 'named'        // import { foo } from './foo'
  | 'default'      // import foo from './foo'
  | 'namespace'    // import * as foo from './foo'
  | 'side-effect'  // import './foo'
  | 'dynamic'      // import('./foo') — unresolvable statically
  | 'require';     // const foo = require('./foo') — CommonJS

/**
 * A single import statement parsed from the file.
 * `resolvedPath` is filled in by the alias resolver after parsing —
 * adapters leave it null and the scanner populates it.
 */
export interface ParsedImport {
  /** Raw specifier as written: "./services/approval", "@/utils", "express" */
  specifier: string;

  /**
   * Absolute resolved path to the imported file.
   * Null if:
   *   - specifier points to node_modules (external)
   *   - specifier is dynamic (import())
   *   - resolution failed
   */
  resolvedPath: string | null;

  /** Whether this import comes from node_modules or is a local file */
  isExternal: boolean;

  kind: ImportKind;

  /**
   * Named symbols imported from this specifier.
   * Empty for namespace, side-effect, and unresolvable dynamic imports.
   */
  importedNames: string[];

  /** Local alias if renamed: import { foo as bar } → localAlias = 'bar' */
  localAlias?: string;

  location: Range;
}

/**
 * A single export from the file.
 */
export interface ParsedExport {
  /** Name as exported (may differ from internal name via `export { foo as bar }`) */
  exportedName: string;

  /** Internal name within this file, if different from exportedName */
  localName?: string;

  /** True if `export default` */
  isDefault: boolean;

  /**
   * True if this is a re-export from another module:
   *   export { foo } from './foo'
   */
  isReExport: boolean;

  /** For re-exports: the specifier being re-exported from */
  reExportSpecifier?: string;

  location: Range;
}

// ---------------------------------------------------------------------------
// 4. CALL REFERENCE TYPE
// ---------------------------------------------------------------------------

/**
 * A single call expression found inside a symbol's body.
 * The resolver (Layer 2) attempts to bind `calleeName` to a ParsedSymbol.
 */
export interface ParsedCall {
  /**
   * Raw callee expression as written in source:
   *   "updateStatus"
   *   "this.sendTelegram"
   *   "approvalService.approve"
   *   "require('./utils')"
   */
  calleeName: string;

  /**
   * The symbol whose body contains this call.
   * References ParsedSymbol.qualifiedName.
   */
  callerQualifiedName: string;

  location: Range;

  /**
   * True if this call cannot be statically resolved:
   *   - Dynamic import: import('./foo')
   *   - Variable call: const fn = getHandler(); fn()
   *   - Passed reference: arr.map(transform) ← transform referenced, not called here
   */
  isDynamic: boolean;
}

// ---------------------------------------------------------------------------
// 5. PARSED FILE — THE CANONICAL OUTPUT CONTRACT
// ---------------------------------------------------------------------------

/**
 * The complete output of a LanguageAdapter for a single source file.
 *
 * This is the ONLY type the scanner, graph engine, and database layer
 * ever receive from the parser. No language-specific types leak above this.
 *
 * Rule: if you find yourself importing anything from an adapter package
 * above the parser layer, something has gone wrong.
 */
export interface ParsedFile {
  /** Absolute path to the source file */
  filePath: string;

  /** Path relative to the project scan root — used for display */
  relativePath: string;

  /** Language this file was parsed as */
  language: SupportedLanguage;

  /**
   * SHA-256 hex hash of the file contents at parse time.
   * Used by the incremental indexer to skip files that haven't changed.
   * This is the key field that makes incremental indexing possible —
   * more reliable than mtime because it catches content changes regardless
   * of filesystem timestamp behaviour.
   */
  contentHash: string;

  /** Unix timestamp (ms) when this file was parsed */
  parsedAt: number;

  /** All symbols declared in this file */
  symbols: ParsedSymbol[];

  /** All import statements in this file */
  imports: ParsedImport[];

  /** All exports from this file */
  exports: ParsedExport[];

  /**
   * All call expressions found in this file's symbol bodies.
   * The resolver will attempt to bind each to a symbol definition.
   */
  calls: ParsedCall[];

  /**
   * True if the file was parsed with errors.
   * Partial results in symbols/imports/calls may still be useful —
   * the scanner logs errors and continues rather than aborting.
   */
  hasErrors: boolean;

  /** Parse errors encountered — non-fatal */
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  location?: Range;
  severity: 'warning' | 'error';
}

// ---------------------------------------------------------------------------
// 6. SUPPORTED LANGUAGES
// ---------------------------------------------------------------------------

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'      // future — M2 adapter
  | 'go'          // future
  | 'rust'        // future
  | 'java';       // future

// ---------------------------------------------------------------------------
// 7. LANGUAGE ADAPTER INTERFACE
// ---------------------------------------------------------------------------

/**
 * Every language adapter implements this interface.
 * The AdapterRegistry asks each registered adapter `canHandle(filePath)`
 * and delegates to the first match.
 *
 * Adapters are stateless between files — any per-project state
 * (ts-morph Project instance, Python AST cache) is initialised in
 * initialize() and torn down in dispose().
 */
export interface LanguageAdapter {
  /** Human-readable name for logging: "TypeScript adapter (ts-morph)" */
  readonly name: string;

  /** Which language this adapter produces */
  readonly language: SupportedLanguage;

  /**
   * File extensions this adapter handles.
   * Used by the registry for fast pre-filtering before canHandle().
   * Include all extensions — canHandle() does the fine-grained check.
   */
  readonly extensions: string[];

  /**
   * Fine-grained check for whether this adapter should handle a file.
   * Called after extension match. Use for:
   *   - Skipping .d.ts declaration files
   *   - Skipping files inside node_modules
   *   - Detecting JSX inside .js files
   *
   * @param filePath Absolute path to the file
   */
  canHandle(filePath: string): boolean;

  /**
   * Parse a single file and return the canonical ParsedFile.
   *
   * CONTRACT:
   *   - Must never throw. All errors go into ParsedFile.errors.
   *   - Must always return a ParsedFile, even for empty or broken files.
   *   - Must be safe to call concurrently for different filePaths.
   *   - Must not mutate AdapterConfig.
   *
   * @param filePath Absolute path to the file to parse
   * @param config   Project-level configuration for this scan
   */
  parse(filePath: string, config: AdapterConfig): Promise<ParsedFile>;

  /**
   * Called once before a scan begins.
   * Use to initialise expensive per-scan resources:
   *   TypeScript: new Project({ tsConfigFilePath })
   *   Python: build import resolver from sys.path
   *
   * Optional — adapters that need no warm-up can omit this.
   */
  initialize?(config: AdapterConfig): Promise<void>;

  /**
   * Called once after a scan completes or is aborted.
   * Use to release resources held during initialize().
   * Optional.
   */
  dispose?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 8. ADAPTER CONFIGURATION
// ---------------------------------------------------------------------------

/**
 * Project-level configuration passed to every adapter on initialize() and parse().
 * Adapters read only the fields relevant to their language.
 * This type grows as new adapters need new config — never break existing fields.
 */
export interface AdapterConfig {
  /** Absolute path to the project scan root */
  projectRoot: string;

  /** Absolute path to tsconfig.json, if found — used by TypeScript adapter */
  tsconfigPath?: string;

  /**
   * Resolved path aliases from tsconfig.json `paths`.
   * Key: alias prefix ("@/")  Value: resolved base path ("/abs/path/to/src/")
   * Pre-resolved by the scanner before adapters are invoked.
   */
  pathAliases: Record<string, string>;

  /** Absolute paths to exclude from parsing (beyond .gitignore) */
  excludePaths: string[];

  /**
   * Adapter-specific config block from gmap.config.json.
   * Keyed by language name.
   * e.g. { "typescript": { "strictMode": true }, "python": { "venvPath": ".venv" } }
   */
  adapterOptions?: Partial<Record<SupportedLanguage, Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// 9. ADAPTER REGISTRY
// ---------------------------------------------------------------------------

/**
 * The AdapterRegistry is the single point through which the scanner
 * selects an adapter for a given file.
 *
 * The scanner imports ONLY the registry — never a specific adapter.
 * Adapters are injected at startup in the CLI/extension entry point.
 *
 * Usage:
 *
 *   // In CLI entry point:
 *   const registry = new AdapterRegistry();
 *   registry.register(new TypeScriptAdapter());
 *   // registry.register(new PythonAdapter()); // uncomment when ready
 *
 *   // In scanner:
 *   const adapter = registry.resolve(filePath);
 *   if (!adapter) { skip file }
 *   const parsed = await adapter.parse(filePath, config);
 */
export class AdapterRegistry {
  private adapters: LanguageAdapter[] = [];

  /**
   * Register an adapter.
   * Adapters are checked in registration order — register more specific
   * adapters before more general ones.
   */
  register(adapter: LanguageAdapter): this {
    this.adapters.push(adapter);
    return this; // fluent: registry.register(ts).register(py)
  }

  /**
   * Find the first adapter that can handle this file path.
   * Returns null if no adapter matches — the scanner skips the file.
   */
  resolve(filePath: string): LanguageAdapter | null {
    const ext = filePath.slice(filePath.lastIndexOf('.'));

    for (const adapter of this.adapters) {
      if (adapter.extensions.includes(ext) && adapter.canHandle(filePath)) {
        return adapter;
      }
    }

    return null;
  }

  /** All registered adapters — for logging and diagnostics */
  list(): LanguageAdapter[] {
    return [...this.adapters];
  }

  /**
   * All file extensions handled by registered adapters.
   * Used by the file walker to pre-filter which files to visit —
   * avoids stat-ing files the registry will never handle.
   */
  handledExtensions(): Set<string> {
    return new Set(this.adapters.flatMap(a => a.extensions));
  }

  /**
   * Initialise all registered adapters for a scan.
   * Called once by the scanner before walking the file tree.
   */
  async initializeAll(config: AdapterConfig): Promise<void> {
    await Promise.all(
      this.adapters.map(a => a.initialize?.(config))
    );
  }

  /**
   * Dispose all registered adapters after a scan completes or fails.
   * Called in a finally block — always runs.
   */
  async disposeAll(): Promise<void> {
    await Promise.all(
      this.adapters.map(a => a.dispose?.())
    );
  }
}

// ---------------------------------------------------------------------------
// 10. TYPESCRIPT ADAPTER STUB
// ---------------------------------------------------------------------------

/**
 * Concrete stub showing how the TypeScript adapter implements LanguageAdapter.
 * The real implementation lives in:
 *   packages/core/src/adapters/typescript/index.ts
 *
 * This stub is here to make the contract tangible — reading an interface
 * without a concrete example leaves too much to interpretation.
 */
export class TypeScriptAdapter implements LanguageAdapter {
  readonly name = 'TypeScript adapter (ts-morph)';
  readonly language: SupportedLanguage = 'typescript';
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  private project: unknown = null; // ts-morph Project in real implementation

  canHandle(filePath: string): boolean {
    // Declaration files have no runtime symbols — skip them
    if (filePath.endsWith('.d.ts')) return false;
    // Never parse inside node_modules
    if (filePath.includes('/node_modules/')) return false;
    return true;
  }

  async initialize(config: AdapterConfig): Promise<void> {
    // Real implementation:
    //   this.project = new Project({
    //     tsConfigFilePath: config.tsconfigPath,
    //     addFilesFromTsConfig: false, // we control file addition
    //   });
    void config;
    this.project = {}; // placeholder
  }

  async parse(filePath: string, config: AdapterConfig): Promise<ParsedFile> {
    // Real implementation delegates to:
    //   extractors/functions.ts  → ParsedSymbol[]
    //   extractors/classes.ts    → ParsedSymbol[]
    //   extractors/imports.ts    → ParsedImport[]
    //   extractors/exports.ts    → ParsedExport[]
    //   extractors/calls.ts      → ParsedCall[]
    // then computes contentHash and assembles ParsedFile.
    void config;

    return {
      filePath,
      relativePath: filePath,      // real: path.relative(config.projectRoot, filePath)
      language: 'typescript',
      contentHash: '',             // real: sha256(await fs.readFile(filePath))
      parsedAt: Date.now(),
      symbols: [],
      imports: [],
      exports: [],
      calls: [],
      hasErrors: false,
      errors: [],
    };
  }

  async dispose(): Promise<void> {
    this.project = null;
  }
}

// ---------------------------------------------------------------------------
// 11. USAGE EXAMPLE (not shipped — for documentation only)
// ---------------------------------------------------------------------------

/*

// packages/cli/src/commands/scan.ts

import { AdapterRegistry, AdapterConfig } from '@gmap/core/adapters';
import { TypeScriptAdapter } from '@gmap/core/adapters/typescript';

const registry = new AdapterRegistry()
  .register(new TypeScriptAdapter());
  // .register(new PythonAdapter());  ← future, zero other changes needed

const config: AdapterConfig = {
  projectRoot: '/path/to/project',
  tsconfigPath: '/path/to/project/tsconfig.json',
  pathAliases: { '@/': '/path/to/project/src/' },
  excludePaths: ['/path/to/project/dist'],
};

await registry.initializeAll(config);

try {
  for (const filePath of filesToScan) {
    const adapter = registry.resolve(filePath);
    if (!adapter) continue;

    const parsed = await adapter.parse(filePath, config);
    await db.insertParsedFile(parsed); // graph engine takes it from here
  }
} finally {
  await registry.disposeAll();
}

*/
