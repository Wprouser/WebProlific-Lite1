import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '../repositories/user.repository';
import { TwoFactorAuthRepository } from '../repositories/two-factor-auth.repository';
import { TwoFactorChallengeRepository } from '../repositories/two-factor-challenge.repository';
import { TwoFactorBackupCodeRepository } from '../repositories/two-factor-backup-code.repository';
import {
  USER_REPOSITORY,
  TWO_FACTOR_AUTH_REPOSITORY,
  TWO_FACTOR_CHALLENGE_REPOSITORY,
  TWO_FACTOR_BACKUP_CODE_REPOSITORY,
} from '../repositories/tokens';
import { OTP_DISPATCHER, OtpDispatcher } from './otp-dispatcher.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { PasswordService } from './password.service';
import { AuthService } from './auth.service';
import { LoginSuccessResponse } from './auth-responses';
import { generateBackupCode, generateNumericOtp } from './otp-code.util';
import { maskDestination } from './mask-destination.util';
import { EnrollStartDto } from '../dto/enroll-start.dto';
import { EnrollConfirmDto } from '../dto/enroll-confirm.dto';
import { DisableTwoFactorDto } from '../dto/disable-two-factor.dto';
import { SetTwoFactorPolicyDto } from '../dto/set-two-factor-policy.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import {
  PROPERTY_REPOSITORY,
  OUTLET_REPOSITORY,
  USER_ACCESS_REPOSITORY,
} from '../../tenancy/repositories/tokens';
import { PropertyRepository } from '../../tenancy/repositories/property.repository';
import { OutletRepository } from '../../tenancy/repositories/outlet.repository';
import { UserAccessRepository } from '../../tenancy/repositories/user-access.repository';

@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(TWO_FACTOR_AUTH_REPOSITORY)
    private readonly twoFactorAuthRepository: TwoFactorAuthRepository,
    @Inject(TWO_FACTOR_CHALLENGE_REPOSITORY)
    private readonly twoFactorChallengeRepository: TwoFactorChallengeRepository,
    @Inject(TWO_FACTOR_BACKUP_CODE_REPOSITORY)
    private readonly twoFactorBackupCodeRepository: TwoFactorBackupCodeRepository,
    @Inject(OTP_DISPATCHER) private readonly otpDispatcher: OtpDispatcher,
    @Inject(PROPERTY_REPOSITORY) private readonly propertyRepository: PropertyRepository,
    @Inject(OUTLET_REPOSITORY) private readonly outletRepository: OutletRepository,
    @Inject(USER_ACCESS_REPOSITORY) private readonly userAccessRepository: UserAccessRepository,
    private readonly tokenService: TokenService,
    private readonly totpService: TotpService,
    private readonly passwordService: PasswordService,
    private readonly authService: AuthService,
  ) {}

  /** Resolves the acting user from a Bearer token (voluntary enrollment) or
   * a pendingEnrollmentToken (forced enrollment — see AuthService.login). */
  private async resolveEnrollingUserId(
    request: RequestWithAccess,
    pendingEnrollmentToken?: string,
  ): Promise<string> {
    if (request.user?.id) return request.user.id;
    if (pendingEnrollmentToken) {
      const challenge = await this.twoFactorChallengeRepository.findById(pendingEnrollmentToken);
      if (challenge && !challenge.consumedAt && challenge.expiresAt.getTime() > Date.now()) {
        return challenge.userId;
      }
    }
    throw new UnauthorizedException('Authentication required');
  }

  async enrollStart(request: RequestWithAccess, dto: EnrollStartDto) {
    const userId = await this.resolveEnrollingUserId(request, dto.pendingEnrollmentToken);
    const user = await this.getUserOrThrow(userId);
    const twoFactor = await this.twoFactorAuthRepository.findOrCreateByUserId(userId);
    if (twoFactor.isEnabled) {
      throw new BadRequestException('Two-factor is already enabled — disable it first to change method');
    }

    if (dto.method === 'TOTP') {
      const secret = this.totpService.generateSecret();
      await this.twoFactorAuthRepository.update(userId, {
        method: 'TOTP',
        totpSecret: this.totpService.encryptSecret(secret),
      });
      return { method: 'TOTP' as const, secret, otpauthUrl: this.totpService.keyUri(user.email, secret) };
    }

    const destination = dto.method === 'SMS' ? user.phone : user.email;
    if (!destination) {
      throw new BadRequestException(`No ${dto.method === 'SMS' ? 'phone number' : 'email'} on file`);
    }
    const otp = generateNumericOtp();
    await this.otpDispatcher.dispatch({ destination, method: dto.method, code: otp, purpose: 'TWO_FACTOR' });
    const challenge = await this.twoFactorChallengeRepository.create({
      userId,
      code: this.tokenService.hashOpaqueToken(otp),
      method: dto.method,
      expiresAt: this.tokenService.pendingTwoFactorExpiry(),
    });
    await this.twoFactorAuthRepository.update(userId, { method: dto.method });
    return {
      method: dto.method,
      maskedDestination: maskDestination(destination, dto.method),
      enrollmentChallengeId: challenge.id,
    };
  }

  async enrollConfirm(
    request: RequestWithAccess,
    dto: EnrollConfirmDto,
  ): Promise<{ backupCodes: string[]; login?: LoginSuccessResponse }> {
    const wasAlreadyAuthenticated = !!request.user?.id;
    const userId = await this.resolveEnrollingUserId(request, dto.pendingEnrollmentToken);
    const twoFactor = await this.twoFactorAuthRepository.findOrCreateByUserId(userId);

    if (dto.method === 'TOTP') {
      if (!twoFactor.totpSecret) throw new BadRequestException('No pending TOTP enrollment');
      const secret = this.totpService.decryptSecret(twoFactor.totpSecret);
      if (!this.totpService.verify(dto.code, secret)) {
        throw new BadRequestException('Invalid confirmation code');
      }
    } else {
      if (!dto.enrollmentChallengeId) {
        throw new BadRequestException('enrollmentChallengeId is required for SMS/EMAIL enrollment');
      }
      const challenge = await this.twoFactorChallengeRepository.findById(dto.enrollmentChallengeId);
      if (
        !challenge ||
        challenge.userId !== userId ||
        challenge.consumedAt ||
        challenge.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException('Invalid or expired enrollment session');
      }
      const hash = this.tokenService.hashOpaqueToken(dto.code);
      if (challenge.code !== hash) {
        await this.twoFactorChallengeRepository.incrementAttemptCount(challenge.id);
        throw new BadRequestException('Invalid confirmation code');
      }
      await this.twoFactorChallengeRepository.consume(challenge.id);
    }

    await this.twoFactorAuthRepository.update(userId, {
      isEnabled: true,
      method: dto.method,
      enrolledAt: new Date(),
    });
    const backupCodes = await this.issueBackupCodes(twoFactor.id);

    if (wasAlreadyAuthenticated) {
      // Voluntary enrollment (Settings screen) — caller already has valid
      // tokens from being logged in.
      return { backupCodes };
    }
    // Forced enrollment (spec: "required to complete enrollment on next
    // login before reaching the app") — consume the pendingEnrollmentToken
    // and hand back real login tokens in the same response, completing the
    // login that /auth/login deferred.
    if (dto.pendingEnrollmentToken) {
      await this.twoFactorChallengeRepository.consume(dto.pendingEnrollmentToken);
    }
    return { backupCodes, login: await this.authService.issueTokensForUserId(userId) };
  }

  async regenerateBackupCodes(userId: string): Promise<{ backupCodes: string[] }> {
    const twoFactor = await this.twoFactorAuthRepository.findByUserId(userId);
    if (!twoFactor?.isEnabled) throw new BadRequestException('Two-factor is not enabled');
    return { backupCodes: await this.issueBackupCodes(twoFactor.id) };
  }

  async disable(userId: string, dto: DisableTwoFactorDto): Promise<void> {
    const user = await this.getUserOrThrow(userId);
    if (!user.passwordHash || !(await this.passwordService.verify(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid password');
    }

    const twoFactor = await this.twoFactorAuthRepository.findByUserId(userId);
    if (!twoFactor?.isEnabled) throw new BadRequestException('Two-factor is not enabled');

    if (!(await this.verifyFinalCheckCode(twoFactor.id, twoFactor.totpSecret, dto.code))) {
      throw new UnauthorizedException('Invalid code');
    }

    await this.twoFactorAuthRepository.update(userId, {
      isEnabled: false,
      totpSecret: null,
      enrolledAt: null,
    });
    await this.twoFactorBackupCodeRepository.deleteUnused(twoFactor.id);
  }

  /** FR-14's admin override (`/users/:id/reset-2fa-admin`, e.g. "user lost
   * their device") — same end state as `disable()` but skips the target's
   * own password/code check, since the caller (an admin) has already
   * re-authenticated themselves before this is invoked (see
   * UsersService.assertAdminReauth). A no-op if the target has no 2FA. */
  async adminReset(userId: string): Promise<void> {
    const twoFactor = await this.twoFactorAuthRepository.findByUserId(userId);
    if (!twoFactor) return;
    await this.twoFactorAuthRepository.update(userId, {
      isEnabled: false,
      totpSecret: null,
      enrolledAt: null,
    });
    await this.twoFactorBackupCodeRepository.deleteUnused(twoFactor.id);
  }

  /**
   * Not in the spec's FR-13 endpoint table — the table has no route for
   * setting `TwoFactorAuth.enforcedByPolicy`, needed for the business logic
   * & acceptance criteria around chain-wide enforcement. Authorization
   * (CHAIN_OWNER on this chain) is now handled by FR-11's RolesGuard via
   * `@Roles('CHAIN_OWNER') @ResourceScope('chain', 'body.chainId')` on the
   * controller route — this method is pure business logic.
   */
  async setPolicy(dto: SetTwoFactorPolicyDto): Promise<{ affectedUsers: number }> {
    const propertyIds = await this.propertyRepository.findIdsByChainId(dto.chainId);
    const outletIds = await this.outletRepository.findIdsByChainId(dto.chainId);
    const [chainUserIds, propertyUserIds, outletUserIds] = await Promise.all([
      this.userAccessRepository.findUserIdsByScope('CHAIN', [dto.chainId]),
      this.userAccessRepository.findUserIdsByScope('PROPERTY', propertyIds),
      this.userAccessRepository.findUserIdsByScope('OUTLET', outletIds),
    ]);
    const userIds = Array.from(new Set([...chainUserIds, ...propertyUserIds, ...outletUserIds]));

    for (const userId of userIds) {
      await this.twoFactorAuthRepository.findOrCreateByUserId(userId);
      await this.twoFactorAuthRepository.update(userId, { enforcedByPolicy: dto.enforcedByPolicy });
    }
    return { affectedUsers: userIds.length };
  }

  private async issueBackupCodes(twoFactorAuthId: string): Promise<string[]> {
    await this.twoFactorBackupCodeRepository.deleteUnused(twoFactorAuthId);
    const codes = Array.from({ length: 10 }, () => generateBackupCode());
    const hashes = await Promise.all(codes.map((code) => this.passwordService.hash(code)));
    await this.twoFactorBackupCodeRepository.createBatch(twoFactorAuthId, hashes);
    return codes; // one-time plaintext list — never stored, only hashes are
  }

  /**
   * "A valid 2FA code as a final check" for /disable: TOTP verifies directly
   * against the live secret; SMS/EMAIL has no fresh dispatched challenge at
   * this point (the spec gives /disable no separate start step), so a valid
   * unused backup code satisfies the check instead — legitimate since backup
   * codes are explicitly method-agnostic elsewhere in the spec.
   */
  private async verifyFinalCheckCode(
    twoFactorAuthId: string,
    totpSecret: string | null,
    code: string,
  ): Promise<boolean> {
    if (totpSecret && this.totpService.verify(code, this.totpService.decryptSecret(totpSecret))) {
      return true;
    }
    const unused = await this.twoFactorBackupCodeRepository.findUnusedByTwoFactorAuthId(twoFactorAuthId);
    for (const candidate of unused) {
      if (await this.passwordService.verify(code.toUpperCase(), candidate.codeHash)) {
        await this.twoFactorBackupCodeRepository.markUsed(candidate.id);
        return true;
      }
    }
    return false;
  }

  /**
   * Public wrapper around the TOTP-or-backup-code check, reused by FR-14's
   * admin-triggered `/users/:id/reset-2fa-admin` and
   * `/users/:id/reset-password-admin`, both of which require the acting
   * admin to pass a fresh 2FA check as part of the same request (spec:
   * "requires the acting admin to itself pass a 2FA step" / "requiring the
   * acting admin's own re-authentication"). Returns false (never throws) if
   * the admin doesn't even have 2FA enabled — callers reject that case.
   */
  async verifyCurrentCode(userId: string, code: string): Promise<boolean> {
    const twoFactor = await this.twoFactorAuthRepository.findByUserId(userId);
    if (!twoFactor?.isEnabled) return false;
    return this.verifyFinalCheckCode(twoFactor.id, twoFactor.totpSecret, code);
  }

  private async getUserOrThrow(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');
    return user;
  }
}
