// Imported first by the test suite so db.ts opens an in-memory database
// instead of wiping and seeding the developer's data/streetsync.db.
process.env.DB_PATH = ":memory:";
