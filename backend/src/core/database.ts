import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'freshmart',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export class Database {
  static async query(text: string, params?: any[]) {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      console.log(`Query executed in ${Date.now() - start}ms`);
      return result;
    } catch (error) {
      console.error('Database error:', error);
      throw error;
    }
  }

  static async getClient(): Promise<PoolClient> {
    return await pool.connect();
  }

  static async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async close() {
    await pool.end();
  }
}

export default Database;
