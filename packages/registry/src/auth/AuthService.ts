import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RegistryAuthConfig } from '../types';

export class AuthService {
  constructor(private readonly config: RegistryAuthConfig) {}

  async authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Basic ')) {
      return reply.code(401).header('www-authenticate', 'Basic realm="Gaesup Registry"').send({ error: 'Authentication required' });
    }

    const [username, password] = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8').split(':');
    if (username !== this.config.username || password !== this.config.password) {
      return reply.code(403).send({ error: 'Invalid credentials' });
    }

    return undefined;
  }
}
