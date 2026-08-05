import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '../repositories/user.repository';
import { TwoFactorAuthRepository } from '../repositories/two-factor-auth.repository';
import { TwoFactorChallengeRepository } from '../repositories/two-factor-challenge.repository';
import { TwoFactorBackupCodeRepository } from '../repositories/two-factor-backup-code.repository';
import { TrustedDeviceRepository } from '../repositories/trusted-device.repository';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { PasswordResetTokenRepository } from '../repositories/password-reset-token.repository';
import {
  USER_REPOSITORY,
  TWO_FACTOR_AUTH_REPOSITORY,
  TWO_FACTOR_CHALLENGE_REPOSITORY,
  TWO_FACTOR_BACKUP_CODE_REPOSITORY,
  TRUSTED_DEVICE_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  PASSWORD_RESET_TOKEN_REPOSITORY,
} from '../repositories/tokens';
import { OTP_DISPATCHER, OtpDispatcher } from './otp-dispatcher.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { PasswordService } from './password.service';
import { generateNumericOtp } from './otp-code.util';
import { maskDestination } from './mask-destination.util';
import { LoginDto } from '../dto/login.dto';
import { VerifyTwoFactorDto } from '../dto/verify-two-factor.dto';
import { ResendTwoFactorDto } from '../dto/resend-two-factor.dto';
import { BackupCodeLoginDto } from '../dto/backup-code-login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { User } from '../domain/user.entity';
import { TwoFactorAuth } from '../domain/two-factor-auth.entity';
import { TwoFactorChallenge } from '../domain/two-factor-challenge.entity';
import { ScopeResolutionService } from '../../tenancy/services/scope-resolution.service';
import { ActivityBus } from '../../activity-log/services/activity-bus.service';
import {
  LoginResponse,
  LoginSuccessResponse,
  RequiresTwoFactorEnrollmentResponse,
  RequiresTwoFactorResponse,
} from './auth-responses';

const MAX_TWO_FACTOR_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(TWO_FACTOR_AUTH_REPOSITORY)
    private readonly twoFactorAuthRepository: TwoFactorAuthRepository,
    @Inject(TWO_FACTOR_CHALLENGE_REPOSITORY)
    private readonly twoFactorChallengeRepository: TwoFactorChallengeRepository,
    @Inject(TWO_FACTOR_BACKUP_CODE_REPOSITORY)
    private readonly twoFactorBackupCodeRepository: TwoFactorBackupCodeRepository,
    @Inject(TRUSTED_DEVICE_REPOSITORY)
    private readonly trustedDeviceRepository: TrustedDeviceRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokenRepository: RefreshTokenRepository,
    @Inject(PASSWORD_RESET_TOKEN_REPOSITORY)
    private readonly passwordResetTokenRepository: PasswordResetTokenRepository,
    @Inject(OTP_DISPATCHER) private readonly otpDispatcher: OtpDispatcher,
    private readonly tokenService: TokenService,
    private readonly totpService: TotpService,
    private readonly passwordService: PasswordService,
    private readonly scopeResolutionService: ScopeResolutionService,
    private readonly activityBus: ActivityBus,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.userRepository.findByEmail(dto.email);
    // Same generic message whether the email doesn't exist, the account has
    // no password yet (FR-14 invite not accepted), or the password is
    // wrong — don't leak which one it was.
    if (
      !user ||
      !user.isActive ||
      !user.passwordHash ||
      !(await this.passwordService.verify(dto.password, user.passwordHash))
    ) {
      // Only emit LOGIN_FAILED when we actually resolved a user (wrong
      // password / inactive account for a real account) — logging an
      // attempt against a nonexistent email would just be scan/bot noise,
      // not the "who logged in and when" signal the spec is after.
      if (user) {
        await this.activityBus.record({
          userId: user.id,
          category: 'AUTH',
          action: 'LOGIN_FAILED',
          entityType: 'User',
          entityId: user.id,
          descriptionKey: 'activity.auth.login_failed',
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.completeLoginFlow(user, dto.trustedDeviceToken);
  }

  /**
   * Shared tail of the login business logic (spec steps 2-4: trusted-device
   * skip, 2FA policy enforcement/challenge, or direct token issuance) —
   * factored out so FR-14's accept-invite flow can reuse it verbatim as its
   * own "first login" once the user sets their password, without
   * re-deriving the 2FA-enforcement logic.
   */
  async completeLoginFlow(user: User, trustedDeviceToken?: string): Promise<LoginResponse> {
    if (trustedDeviceToken) {
      const hash = this.tokenService.hashOpaqueToken(trustedDeviceToken);
      const device = await this.trustedDeviceRepository.findValidByTokenHash(hash);
      if (device && device.userId === user.id) {
        return this.issueTokensForUser(user);
      }
    }

    const twoFactor = await this.twoFactorAuthRepository.findByUserId(user.id);

    if (twoFactor?.enforcedByPolicy && !twoFactor.isEnabled) {
      const challenge = await this.twoFactorChallengeRepository.create({
        userId: user.id,
        code: null,
        method: twoFactor.method,
        expiresAt: this.tokenService.pendingTwoFactorExpiry(),
      });
      const response: RequiresTwoFactorEnrollmentResponse = {
        requiresTwoFactorEnrollment: true,
        pendingEnrollmentToken: challenge.id,
      };
      return response;
    }

    if (twoFactor?.isEnabled) {
      return this.beginTwoFactorChallenge(user, twoFactor);
    }

    return this.issueTokensForUser(user);
  }

  async verifyTwoFactor(dto: VerifyTwoFactorDto): Promise<LoginSuccessResponse> {
    const challenge = await this.getValidChallenge(dto.pendingTwoFactorToken);
    await this.enforceAttemptLimit(challenge);
    const user = await this.getUserOrThrow(challenge.userId);

    let valid: boolean;
    if (challenge.method === 'TOTP') {
      const twoFactor = await this.twoFactorAuthRepository.findByUserId(user.id);
      valid = !!twoFactor?.totpSecret && this.totpService.verify(dto.code, this.totpService.decryptSecret(twoFactor.totpSecret));
    } else {
      const hash = this.tokenService.hashOpaqueToken(dto.code);
      valid = !!challenge.code && challenge.code === hash;
    }

    if (!valid) {
      await this.twoFactorChallengeRepository.incrementAttemptCount(challenge.id);
      throw new UnauthorizedException('Invalid code');
    }

    await this.twoFactorChallengeRepository.consume(challenge.id);
    return this.finishTwoFactorLogin(user, dto.trustDevice, dto.deviceLabel);
  }

  async resendTwoFactor(dto: ResendTwoFactorDto): Promise<{ sent: true }> {
    const challenge = await this.getValidChallenge(dto.pendingTwoFactorToken);
    if (challenge.method === 'TOTP') {
      throw new BadRequestException('Resend is not applicable for TOTP — use your authenticator app');
    }
    const user = await this.getUserOrThrow(challenge.userId);
    const destination = challenge.method === 'SMS' ? user.phone : user.email;
    if (!destination) throw new BadRequestException('No destination on file for this method');

    const otp = generateNumericOtp();
    await this.otpDispatcher.dispatch({ destination, method: challenge.method, code: otp, purpose: 'TWO_FACTOR' });
    await this.twoFactorChallengeRepository.updateCode(
      challenge.id,
      this.tokenService.hashOpaqueToken(otp),
      this.tokenService.pendingTwoFactorExpiry(),
    );
    return { sent: true };
  }

  async loginWithBackupCode(dto: BackupCodeLoginDto): Promise<LoginSuccessResponse> {
    const challenge = await this.getValidChallenge(dto.pendingTwoFactorToken);
    await this.enforceAttemptLimit(challenge);
    const user = await this.getUserOrThrow(challenge.userId);
    const twoFactor = await this.twoFactorAuthRepository.findByUserId(user.id);
    if (!twoFactor) throw new UnauthorizedException('Invalid backup code');

    const unused = await this.twoFactorBackupCodeRepository.findUnusedByTwoFactorAuthId(twoFactor.id);
    let matchedId: string | undefined;
    for (const candidate of unused) {
      if (await this.passwordService.verify(dto.backupCode.toUpperCase(), candidate.codeHash)) {
        matchedId = candidate.id;
        break;
      }
    }

    if (!matchedId) {
      await this.twoFactorChallengeRepository.incrementAttemptCount(challenge.id);
      throw new UnauthorizedException('Invalid backup code');
    }

    await this.twoFactorBackupCodeRepository.markUsed(matchedId);
    await this.twoFactorChallengeRepository.consume(challenge.id);
    return this.finishTwoFactorLogin(user, dto.trustDevice, dto.deviceLabel);
  }

  async refresh(dto: RefreshTokenDto): Promise<Omit<LoginSuccessResponse, 'trustedDeviceToken'>> {
    const hash = this.tokenService.hashOpaqueToken(dto.refreshToken);
    const stored = await this.refreshTokenRepository.findByTokenHash(hash);
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    await this.refreshTokenRepository.revoke(stored.id); // rotation: single-use
    const user = await this.getUserOrThrow(stored.userId);
    // false: token rotation isn't a new login — no LOGIN_SUCCESS here.
    return this.issueTokensForUser(user, false);
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    const hash = this.tokenService.hashOpaqueToken(dto.refreshToken);
    const stored = await this.refreshTokenRepository.findByTokenHash(hash);
    if (stored && !stored.revokedAt) {
      await this.refreshTokenRepository.revoke(stored.id);
      await this.activityBus.record({
        userId: stored.userId,
        category: 'AUTH',
        action: 'LOGOUT',
        entityType: 'User',
        entityId: stored.userId,
        descriptionKey: 'activity.auth.logout',
      });
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenRepository.revokeAllForUser(userId);
    await this.activityBus.record({
      userId,
      category: 'AUTH',
      action: 'LOGOUT_ALL',
      entityType: 'User',
      entityId: userId,
      descriptionKey: 'activity.auth.logout_all',
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ sent: true }> {
    const user = await this.userRepository.findByEmail(dto.email);
    // Always respond the same way whether or not the account exists.
    if (user) {
      await this.issuePasswordResetToken(user);
    }
    return { sent: true };
  }

  /** Reused by FR-14's admin-triggered `/users/:id/reset-password-admin` —
   * same token issuance, just invoked without the caller needing to know
   * the target's email/current password. */
  async issuePasswordResetToken(user: User): Promise<void> {
    const raw = this.tokenService.generateOpaqueToken();
    await this.passwordResetTokenRepository.create({
      userId: user.id,
      tokenHash: this.tokenService.hashOpaqueToken(raw),
      expiresAt: this.tokenService.passwordResetExpiry(),
    });
    await this.otpDispatcher.dispatch({ destination: user.email, method: 'EMAIL', code: raw, purpose: 'PASSWORD_RESET' });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: true }> {
    const hash = this.tokenService.hashOpaqueToken(dto.token);
    const stored = await this.passwordResetTokenRepository.findByTokenHash(hash);
    if (!stored || stored.usedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.userRepository.update(stored.userId, { passwordHash });
    await this.passwordResetTokenRepository.markUsed(stored.id);
    // Resetting the password invalidates every existing session.
    await this.refreshTokenRepository.revokeAllForUser(stored.userId);
    await this.activityBus.record({
      userId: stored.userId,
      category: 'AUTH',
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: stored.userId,
      descriptionKey: 'activity.auth.password_reset',
    });
    return { success: true };
  }

  /** Public wrapper so TwoFactorService can finish a forced-enrollment login
   * (see enroll/confirm) without duplicating token-issuing logic here. */
  async issueTokensForUserId(userId: string): Promise<LoginSuccessResponse> {
    return this.issueTokensForUser(await this.getUserOrThrow(userId));
  }

  async getProfile(userId: string) {
    const user = await this.getUserOrThrow(userId);
    const twoFactor = await this.twoFactorAuthRepository.findByUserId(userId);
    const access = await this.scopeResolutionService.resolveEffectiveAccess(userId);
    return {
      id: user.id,
      email: user.email,
      preferredLanguage: user.preferredLanguage,
      preferredCurrency: user.preferredCurrency,
      twoFactorEnabled: twoFactor?.isEnabled ?? false,
      twoFactorMethod: twoFactor?.method ?? null,
      effectiveRole: access.effectiveRole,
      effectiveOutletIds: access.effectiveOutletIds,
    };
  }

  private async finishTwoFactorLogin(
    user: User,
    trustDevice?: boolean,
    deviceLabel?: string,
  ): Promise<LoginSuccessResponse> {
    const result = await this.issueTokensForUser(user);
    if (trustDevice) {
      result.trustedDeviceToken = await this.createTrustedDeviceToken(user.id, deviceLabel);
    }
    return result;
  }

  private async beginTwoFactorChallenge(
    user: User,
    twoFactor: TwoFactorAuth,
  ): Promise<RequiresTwoFactorResponse> {
    const method = twoFactor.method;
    let code: string | null = null;
    let maskedDestination: string | null = null;

    if (method !== 'TOTP') {
      const destination = method === 'SMS' ? user.phone : user.email;
      if (!destination) throw new BadRequestException('No destination on file for this method');
      const otp = generateNumericOtp();
      code = this.tokenService.hashOpaqueToken(otp);
      maskedDestination = maskDestination(destination, method);
      await this.otpDispatcher.dispatch({ destination, method, code: otp, purpose: 'TWO_FACTOR' });
    }

    const challenge = await this.twoFactorChallengeRepository.create({
      userId: user.id,
      code,
      method,
      expiresAt: this.tokenService.pendingTwoFactorExpiry(),
    });

    return {
      requiresTwoFactor: true,
      pendingTwoFactorToken: challenge.id,
      method,
      maskedDestination,
    };
  }

  private async issueTokensForUser(user: User, isNewLogin = true): Promise<LoginSuccessResponse> {
    await this.userRepository.update(user.id, { lastLoginAt: new Date() });
    const accessToken = this.tokenService.signAccessToken(user.id);
    const rawRefresh = this.tokenService.generateOpaqueToken();
    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: this.tokenService.hashOpaqueToken(rawRefresh),
      expiresAt: this.tokenService.refreshTokenExpiry(),
    });
    if (isNewLogin) {
      await this.activityBus.record({
        userId: user.id,
        category: 'AUTH',
        action: 'LOGIN_SUCCESS',
        entityType: 'User',
        entityId: user.id,
        descriptionKey: 'activity.auth.login_success',
      });
    }
    const access = await this.scopeResolutionService.resolveEffectiveAccess(user.id);
    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: this.tokenService.accessTokenExpiresInSeconds,
      user: {
        id: user.id,
        preferredLanguage: user.preferredLanguage,
        effectiveRole: access.effectiveRole,
        effectiveOutletIds: access.effectiveOutletIds,
      },
    };
  }

  private async createTrustedDeviceToken(userId: string, deviceLabel?: string): Promise<string> {
    const raw = this.tokenService.generateOpaqueToken();
    await this.trustedDeviceRepository.create({
      userId,
      deviceToken: this.tokenService.hashOpaqueToken(raw),
      deviceLabel,
      expiresAt: this.tokenService.trustedDeviceExpiry(),
    });
    return raw;
  }

  private async getValidChallenge(id: string): Promise<TwoFactorChallenge> {
    const challenge = await this.twoFactorChallengeRepository.findById(id);
    if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired two-factor session — please log in again');
    }
    return challenge;
  }

  /** Locks out the whole pending session (not just the one attempt) once the
   * limit is hit, per spec: "enforce attemptCount ≤ 5 ... before invalidating
   * and requiring a fresh login." */
  private async enforceAttemptLimit(challenge: TwoFactorChallenge): Promise<void> {
    if (challenge.attemptCount >= MAX_TWO_FACTOR_ATTEMPTS) {
      await this.twoFactorChallengeRepository.consume(challenge.id);
      throw new UnauthorizedException('Too many failed attempts — please log in again');
    }
  }

  private async getUserOrThrow(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');
    return user;
  }
}
