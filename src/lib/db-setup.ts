import fs from "fs";
import path from "path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

class PGliteClient {
  constructor(private pglite: PGlite) {}

  async query(options: { text: string; values?: any[]; rowMode?: string }) {
    const { text, values, rowMode } = options;
    const res = await this.pglite.query(text, values || []);
    if (rowMode === "array") {
      const rows = res.rows.map((row: any) =>
        res.fields.map((f: any) => {
          const val = row[f.name];
          if (val !== null && typeof val === "object" && !(val instanceof Date) && !Buffer.isBuffer(val) && !Array.isArray(val)) {
            return JSON.stringify(val);
          }
          return val;
        })
      );
      return {
        rows,
        fields: res.fields,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    }
    const rows = res.rows.map((row: any) => {
      const normalized: Record<string, any> = {};
      for (const f of res.fields) {
        const val = row[f.name];
        if (val !== null && typeof val === "object" && !(val instanceof Date) && !Buffer.isBuffer(val) && !Array.isArray(val)) {
          normalized[f.name] = JSON.stringify(val);
        } else {
          normalized[f.name] = val;
        }
      }
      return normalized;
    });
    return {
      rows,
      fields: res.fields,
      rowCount: res.affectedRows ?? res.rows.length,
    };
  }

  on() {}
  removeListener() {}
  release() {}
}

class PGlitePool extends pg.Pool {
  constructor(private pglite: PGlite, private initPromise?: Promise<void>) {
    super();
  }

  // @ts-ignore
  async connect() {
    if (this.initPromise) await this.initPromise;
    return new PGliteClient(this.pglite) as any;
  }

  // @ts-ignore
  async query(options: { text: string; values?: any[]; rowMode?: string }) {
    if (this.initPromise) await this.initPromise;
    const client = new PGliteClient(this.pglite);
    return client.query(options);
  }

  on() { return this as any; }
  removeListener() { return this as any; }
}

const globalForPGlite = globalThis as unknown as {
  pgliteInstance?: PGlite;
  pgliteInitPromise?: Promise<void>;
};

export function getPGlitePool(): PGlitePool {
  const dbDir = path.join(process.cwd(), ".data", "pglite");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (!globalForPGlite.pgliteInstance) {
    globalForPGlite.pgliteInstance = new PGlite(dbDir);
  }

  const pglite = globalForPGlite.pgliteInstance;

  if (!globalForPGlite.pgliteInitPromise) {
    globalForPGlite.pgliteInitPromise = (async () => {
      try {
        const tableCheck = await pglite.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='customers';"
        );
        if (tableCheck.rows.length === 0) {
          console.log("[DB Setup] Auto-initializing database schema from full_schema.sql...");
          const fullSchemaPath = path.join(process.cwd(), "prisma", "full_schema.sql");
          if (fs.existsSync(fullSchemaPath)) {
            const sql = fs.readFileSync(fullSchemaPath, "utf8");
            await pglite.exec(sql);
          } else {
            const initSqlPath = path.join(process.cwd(), "prisma", "migrations", "0_init", "migration.sql");
            if (fs.existsSync(initSqlPath)) {
              const initSql = fs.readFileSync(initSqlPath, "utf8");
              await pglite.exec(initSql);
            }
          }
          console.log("[DB Setup] Schema initialized successfully!");
        } else {
          // Automatically apply incremental migrations
          const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
          if (fs.existsSync(migrationsDir)) {
            const dirs = fs.readdirSync(migrationsDir, { withFileTypes: true })
              .filter((d) => d.isDirectory() && d.name !== "0_init")
              .map((d) => d.name)
              .sort();
            for (const dir of dirs) {
              const migFile = path.join(migrationsDir, dir, "migration.sql");
              if (fs.existsSync(migFile)) {
                try {
                  const sql = fs.readFileSync(migFile, "utf8");
                  await pglite.exec(sql);
                } catch {
                  // Ignore if statements inside migration are already applied or duplicated
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("[DB Setup] Migration error:", err);
      }
    })();
  }

  return new PGlitePool(pglite, globalForPGlite.pgliteInitPromise);
}
