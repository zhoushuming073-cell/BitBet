import type { Pool, PoolConnection, PoolOptions } from "mysql2/promise";

let poolPromise: Promise<Pool> | null = null;

function connectionOptions(): string | PoolOptions {
  const uri = process.env.CONNECTION_URI?.trim();
  if (uri) return uri;

  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME?.trim();
  if (!host || !user || password === undefined || !database) {
    throw new Error(
      "MySQL 未配置：请设置 CONNECTION_URI，或完整设置 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME",
    );
  }
  return {
    host,
    port: Number(process.env.DB_PORT || 3306),
    user,
    password,
    database,
  };
}

export function isMySqlConfigured(): boolean {
  return Boolean(
    process.env.CONNECTION_URI?.trim()
    || (process.env.DB_HOST?.trim()
      && process.env.DB_USER?.trim()
      && process.env.DB_PASSWORD !== undefined
      && process.env.DB_NAME?.trim()),
  );
}

export async function getMySqlPool(): Promise<Pool> {
  if (!poolPromise) {
    poolPromise = import("mysql2/promise").then(({ createPool }) => {
      const options = connectionOptions();
      const pool = typeof options === "string" ? createPool(options) : createPool(options);
      return pool;
    });
  }
  return poolPromise;
}

export async function withTransaction<T>(operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const pool = await getMySqlPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function resetMySqlPoolForTests(): void {
  poolPromise = null;
}
