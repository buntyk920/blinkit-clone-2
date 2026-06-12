import { Database } from '../core/database';
import { createClient } from 'redis';

const redisClient = createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

redisClient.connect();

export class ProductService {
  async getProducts(page: number = 1, limit: number = 20, category?: string) {
    const offset = (page - 1) * limit;
    const cacheKey = `products:${page}:${limit}:${category || 'all'}`;

    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    let query = 'SELECT * FROM products WHERE stock > 0';
    const params: any[] = [];

    if (category) {
      query += ' AND category = $1';
      params.push(category);
    }

    query += ` ORDER BY rating DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await Database.query(query, params);

    // Cache for 1 hour
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));

    return result.rows;
  }

  async getProductById(id: string) {
    const cacheKey = `product:${id}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const result = await Database.query('SELECT * FROM products WHERE id = $1', [id]);

    if (result.rows.length > 0) {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows[0]));
    }

    return result.rows[0];
  }

  async searchProducts(query: string, limit: number = 50) {
    const result = await Database.query(
      `SELECT * FROM products 
       WHERE (name ILIKE $1 OR description ILIKE $1) 
       AND stock > 0
       ORDER BY rating DESC
       LIMIT $2`,
      [`%${query}%`, limit]
    );

    return result.rows;
  }

  async getProductsByCategory(categoryId: string, limit: number = 50) {
    const result = await Database.query(
      `SELECT * FROM products 
       WHERE category_id = $1 AND stock > 0
       ORDER BY rating DESC
       LIMIT $2`,
      [categoryId, limit]
    );

    return result.rows;
  }

  async createProduct(data: any) {
    const {
      name,
      description,
      price,
      category_id,
      image_url,
      stock,
      sku,
    } = data;

    const result = await Database.query(
      `INSERT INTO products (name, description, price, category_id, image_url, stock, sku)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, description, price, category_id, image_url, stock, sku]
    );

    // Invalidate cache
    await redisClient.del('products:*');

    return result.rows[0];
  }

  async updateProduct(id: string, data: any) {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      updates.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    });

    values.push(id);

    const result = await Database.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    // Invalidate caches
    await redisClient.del(`product:${id}`);
    await redisClient.del('products:*');

    return result.rows[0];
  }

  async deleteProduct(id: string) {
    await Database.query('DELETE FROM products WHERE id = $1', [id]);

    // Invalidate caches
    await redisClient.del(`product:${id}`);
    await redisClient.del('products:*');
  }

  async getProductRating(productId: string) {
    const result = await Database.query(
      `SELECT 
        AVG(rating) as average_rating,
        COUNT(*) as review_count
       FROM reviews
       WHERE product_id = $1`,
      [productId]
    );

    return result.rows[0];
  }

  async getRelatedProducts(productId: string, limit: number = 10) {
    const result = await Database.query(
      `SELECT p.* FROM products p
       WHERE p.category_id = (SELECT category_id FROM products WHERE id = $1)
       AND p.id != $1
       AND p.stock > 0
       ORDER BY p.rating DESC
       LIMIT $2`,
      [productId, limit]
    );

    return result.rows;
  }
}

export default new ProductService();
