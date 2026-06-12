import Stripe from 'stripe';
import { Database } from '../core/database';
import { v4 as uuidv4 } from 'uuid';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export class PaymentService {
  async processPayment(orderId: string, amount: number, paymentMethodId: string) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'inr',
        payment_method: paymentMethodId,
        confirm: true,
      });

      // Save payment record
      const result = await Database.query(
        `INSERT INTO payments (id, order_id, amount, payment_method, status, stripe_payment_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          uuidv4(),
          orderId,
          amount,
          'stripe',
          paymentIntent.status,
          paymentIntent.id,
        ]
      );

      // Update order status if payment successful
      if (paymentIntent.status === 'succeeded') {
        await Database.query(
          `UPDATE orders SET status = 'CONFIRMED', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(`Payment failed: ${error.message}`);
    }
  }

  async getPaymentMethods(userId: string) {
    const result = await Database.query(
      `SELECT * FROM payment_methods WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    return result.rows;
  }

  async savePaymentMethod(userId: string, stripePaymentMethodId: string) {
    const paymentMethod = await stripe.paymentMethods.retrieve(
      stripePaymentMethodId
    );

    const result = await Database.query(
      `INSERT INTO payment_methods (id, user_id, stripe_payment_method_id, type, last_four, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [
        uuidv4(),
        userId,
        stripePaymentMethodId,
        paymentMethod.type,
        paymentMethod.card?.last4 || 'N/A',
      ]
    );

    return result.rows[0];
  }

  async refundPayment(paymentId: string) {
    const paymentResult = await Database.query(
      'SELECT stripe_payment_id FROM payments WHERE id = $1',
      [paymentId]
    );

    if (!paymentResult.rows[0]) {
      throw new Error('Payment not found');
    }

    const stripePaymentId = paymentResult.rows[0].stripe_payment_id;

    const refund = await stripe.refunds.create({
      payment_intent: stripePaymentId,
    });

    await Database.query(
      `UPDATE payments SET status = 'REFUNDED', updated_at = NOW() WHERE id = $1`,
      [paymentId]
    );

    return refund;
  }

  async getPaymentHistory(userId: string, limit: number = 50) {
    const result = await Database.query(
      `SELECT p.* FROM payments p
       JOIN orders o ON p.order_id = o.id
       WHERE o.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows;
  }

  async createPaymentIntent(amount: number, currency: string = 'inr') {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
    });

    return paymentIntent;
  }
}

export default new PaymentService();
