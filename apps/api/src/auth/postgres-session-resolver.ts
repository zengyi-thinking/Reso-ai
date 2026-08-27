import type { FastifyRequest } from "fastify";
import type { ProductRepository } from "../product/repository.js";
import { hashToken } from "./session-service.js";

export class PostgresSessionResolver {
  constructor(private readonly repository: ProductRepository) {}

  resolve = async (request: FastifyRequest): Promise<string | null> => {
    const token = bearerToken(request.headers.authorization);
    if (token === null) return null;
    return this.repository.resolveSession(hashToken(token));
  };
}

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length >= 32 && token.length <= 512 ? token : null;
}
