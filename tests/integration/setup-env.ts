// Point every Prisma client in the test process at the disposable test database.
try {
  process.loadEnvFile(".env");
} catch {
  /* CI provides env directly */
}
if (!process.env.DATABASE_URL_TEST) throw new Error("DATABASE_URL_TEST is not set");
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.STORAGE_DIR = process.env.STORAGE_DIR_TEST ?? "./storage-test";
process.env.STALE_SHIFT_HOURS = "16";
