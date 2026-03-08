// Test environment setup — preloaded before any test file is evaluated.
// Sets required environment variables so module-level DB singletons
// don't throw during import in test contexts.
process.env.STRUS_DB_PATH = process.env.STRUS_DB_PATH ?? ":memory:";
