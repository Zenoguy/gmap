// Re-export everything from the language adapter contract.
// See documentation/language-adapter.ts for full type definitions.
export type {
  Position, Range,
  SymbolKind, ParsedSymbol,
  ImportKind, ParsedImport, ParsedExport,
  ParsedCall, ParsedFile, ParseError,
  SupportedLanguage,
  LanguageAdapter, AdapterConfig,
} from './language-adapter.js';
export { AdapterRegistry, TypeScriptAdapter } from './language-adapter.js';
