import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { POS_SIGNATURE_HEADER, verifyPosSignature } from '../lib/verify-pos-signature';

/** Express's json body parser stashes the untouched bytes here — see the
 * `verify` hook wired up in main.ts. */
export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * FR-06 Model 1's authentication. The POS webhook is server-to-server, so
 * it carries no JWT; the route is `@Public()` to get past JwtAuthGuard and
 * this guard is what actually authorizes it.
 *
 * The signature must be checked against the *raw* bytes, not against a
 * re-serialization of the parsed JSON — key order, whitespace and number
 * formatting all survive the wire but not a JSON.parse/stringify round trip,
 * so re-serializing would reject perfectly valid signatures (and, worse,
 * could be made to accept altered ones).
 */
@Injectable()
export class PosSignatureGuard implements CanActivate {
  private readonly logger = new Logger(PosSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const secret = this.config.get<string>('POS_WEBHOOK_SECRET') ?? '';

    if (!secret) {
      // Fail closed. An unconfigured secret must not mean "accept anything"
      // — this endpoint moves real stock, and an open one would let anybody
      // deplete an outlet's inventory.
      this.logger.error('POS_WEBHOOK_SECRET is not configured — rejecting webhook.');
      throw new UnauthorizedException('POS webhook is not configured');
    }

    const raw = request.rawBody;
    if (!raw) {
      this.logger.error('Raw request body was not captured — check the json parser verify hook in main.ts.');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const presented = request.headers[POS_SIGNATURE_HEADER];
    const signature = Array.isArray(presented) ? presented[0] : presented;

    if (!verifyPosSignature(raw, signature, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
