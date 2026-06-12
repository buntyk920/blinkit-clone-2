import { Database } from '../core/database';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export const orderEvents = new EventEmitter();

export class OrderService {
  async createOrder(userId: string, items: any[], deliveryAddress: any) {
    return Database.transaction(async (client) => {
      const orderId = uuidv4();
      const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

      // Create order
      await client.query(
        `INSERT INTO orders (id, user_id, total_amount, status, delivery_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, userId, totalAmount, 'PENDING', JSON.stringify(deliveryAddress)]
      );

      // Create order items and update stock
      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, price)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv4(), orderId, item.product_id, item.quantity, item.price]
        );

        await client.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }

      orderEvents.emit('order:created', { orderId, userId, totalAmount });

      return { orderId, status: 'PENDING', totalAmount };
    });
  }

  async getOrderById(orderId: string) {
    const result = await Database.query(
      `SELECT o.*, json_agg(json_build_object(
        'product_id', oi.product_id, 
        'quantity', oi.quantity, 
        'price', oi.price
       )) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1
       GROUP BY o.id`,
      [orderId]
    );

    return result.rows[0];
  }

  async getUserOrders(userId: string, status?: string, limit: number = 50) {
    let query = 'SELECT * FROM orders WHERE user_id = $1';
    const params: any[] = [userId];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await Database.query(query, params);
    return result.rows;
  }

  async updateOrderStatus(orderId: string, status: string) {
    const result = await Database.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, orderId]
    );

    orderEvents.emit('order:status-changed', { orderId, status });

    return result.rows[0];
  }

  async cancelOrder(orderId: string) {
    return Database.transaction(async (client) => {
      // Get order items
      const itemsResult = await client.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
        [orderId]
      );

      // Restore stock
      for (const item of itemsResult.rows) {
        await client.query(
          `UPDATE products SET stock = stock + $1 WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }

      // Update order status
      await client.query(
        `UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
        [orderId]
      );

      orderEvents.emit('order:cancelled', { orderId });

      return { status: 'CANCELLED' };
    });
  }

  async getOrderStats(userId: string) {
    const result = await Database.query(
      `SELECT 
        COUNT(*) as total_orders,
        SUM(total_amount) as total_spent,
        AVG(total_amount) as average_order_value,
        MAX(created_at) as last_order_date
       FROM orders
       WHERE user_id = $1`,
      [userId]
    );

    return result.rows[0];
  }
}

export default new OrderService();
