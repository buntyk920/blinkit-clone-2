import { Database } from '../core/database';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export const deliveryEvents = new EventEmitter();

export class DeliveryService {
  async assignRider(orderId: string, riderId: string) {
    const result = await Database.query(
      `INSERT INTO deliveries (id, order_id, rider_id, status, assigned_at)
       VALUES ($1, $2, $3, 'ASSIGNED', NOW())
       RETURNING *`,
      [uuidv4(), orderId, riderId]
    );

    deliveryEvents.emit('delivery:assigned', { orderId, riderId });

    return result.rows[0];
  }

  async updateDeliveryLocation(
    deliveryId: string,
    latitude: number,
    longitude: number
  ) {
    const result = await Database.query(
      `UPDATE deliveries 
       SET latitude = $1, longitude = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [latitude, longitude, deliveryId]
    );

    deliveryEvents.emit('delivery:location-updated', {
      deliveryId,
      latitude,
      longitude,
    });

    return result.rows[0];
  }

  async updateDeliveryStatus(deliveryId: string, status: string) {
    const result = await Database.query(
      `UPDATE deliveries 
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, deliveryId]
    );

    deliveryEvents.emit('delivery:status-updated', { deliveryId, status });

    return result.rows[0];
  }

  async getDeliveryTracking(orderId: string) {
    const result = await Database.query(
      `SELECT d.*, r.name as rider_name, r.phone as rider_phone, r.rating
       FROM deliveries d
       LEFT JOIN riders r ON d.rider_id = r.id
       WHERE d.order_id = $1`,
      [orderId]
    );

    return result.rows[0];
  }

  async getAvailableRiders(
    latitude: number,
    longitude: number,
    radius: number = 5
  ) {
    const result = await Database.query(
      `SELECT r.* FROM riders r
       WHERE r.status = 'AVAILABLE'
       AND r.is_verified = true
       ORDER BY r.rating DESC
       LIMIT 10`,
      []
    );

    return result.rows;
  }

  async getRiderDeliveries(riderId: string, status?: string) {
    let query = `SELECT d.*, o.user_id, o.total_amount, o.delivery_address
                 FROM deliveries d
                 JOIN orders o ON d.order_id = o.id
                 WHERE d.rider_id = $1`;
    const params: any[] = [riderId];

    if (status) {
      query += ' AND d.status = $2';
      params.push(status);
    }

    query += ' ORDER BY d.created_at DESC LIMIT 50';

    const result = await Database.query(query, params);
    return result.rows;
  }

  async updateRiderStatus(riderId: string, status: string) {
    const result = await Database.query(
      `UPDATE riders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, riderId]
    );

    return result.rows[0];
  }

  async updateRiderLocation(
    riderId: string,
    latitude: number,
    longitude: number
  ) {
    const result = await Database.query(
      `UPDATE riders SET latitude = $1, longitude = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [latitude, longitude, riderId]
    );

    deliveryEvents.emit('rider:location-updated', {
      riderId,
      latitude,
      longitude,
    });

    return result.rows[0];
  }

  async getRiderStats(riderId: string) {
    const result = await Database.query(
      `SELECT 
        COUNT(*) as total_deliveries,
        COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) as completed_deliveries,
        AVG(rating) as average_rating
       FROM deliveries
       WHERE rider_id = $1`,
      [riderId]
    );

    return result.rows[0];
  }

  async markDeliveryComplete(deliveryId: string) {
    const result = await Database.query(
      `UPDATE deliveries 
       SET status = 'DELIVERED', delivered_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [deliveryId]
    );

    if (result.rows[0]) {
      const delivery = result.rows[0];
      await Database.query(
        `UPDATE orders SET status = 'DELIVERED' WHERE id = $1`,
        [delivery.order_id]
      );

      deliveryEvents.emit('delivery:completed', { deliveryId });
    }

    return result.rows[0];
  }
}

export default new DeliveryService();
