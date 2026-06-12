import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Database } from './database';
import { v4 as uuidv4 } from 'uuid';

export class AuthService {
  private jwtSecret = process.env.JWT_SECRET || 'secret-key';
  private refreshSecret = process.env.REFRESH_SECRET || 'refresh-key';

  async register(email: string, password: string, name: string) {
    const existingUser = await Database.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const result = await Database.query(
      'INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4) RETURNING id, email, name',
      [userId, email, hashedPassword, name]
    );

    const user = result.rows[0];
    return {
      user,
      tokens: this.generateTokens(user.id),
    };
  }

  async login(email: string, password: string) {
    const result = await Database.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      throw new Error('Invalid password');
    }

    return {
      user: { id: user.id, email: user.email, name: user.name },
      tokens: this.generateTokens(user.id),
    };
  }

  generateTokens(userId: string) {
    const accessToken = jwt.sign({ userId }, this.jwtSecret, {
      expiresIn: '15m',
    });

    const refreshToken = jwt.sign({ userId }, this.refreshSecret, {
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  verifyToken(token: string) {
    try {
      return jwt.verify(token, this.jwtSecret) as { userId: string };
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  verifyRefreshToken(token: string) {
    try {
      return jwt.verify(token, this.refreshSecret) as { userId: string };
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }
}

export default new AuthService();
