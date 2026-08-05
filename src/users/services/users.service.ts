import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRepository } from '../../auth/repositories/user.repository';
import { USER_REPOSITORY } from '../../auth/repositories/tokens';
import { UserAccessRepository } from '../../tenancy/repositories/user-access.repository';
import { PropertyRepository } from '../../tenancy/repositories/property.repository';
import { OutletRepository } from '../../tenancy/repositories/outlet.repository';
import {
  USER_ACCESS_REPOSITORY,
  PROPERTY_REPOSITORY,
  OUTLET_REPOSITORY,
} from '../../tenancy/repositories/tokens';
import { InviteTokenRepository } from '../repositories/invite-token.repository';
import { INVITE_TOKEN_REPOSITORY } from '../repositories/tokens';
import { TokenService } from '../../auth/services/token.service';
import { PasswordService } from '../../auth/services/password.service';
import { AuthService } from '../../auth/services/auth.service';
import { TwoFactorService } from '../../auth/services/two-factor.service';
import { OTP_DISPATCHER, OtpDispatcher } from '../../auth/services/otp-dispatcher.service';
import { AuditLogService } from '../../rbac/services/audit-log.service';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { ScopeType } from '../../tenancy/constants/enums';
import { User } from '../../auth/domain/user.entity';
import { LoginResponse } from '../../auth/services/auth-responses';
import { InviteUserDto } from '../dto/invite-user.dto';
import { AcceptInviteDto } from '../dto/accept-invite.dto';
import { UpdateAccessDto } from '../dto/update-access.dto';
import { AdminReauthDto } from '../dto/admin-reauth.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(USER_ACCESS_REPOSITORY) private readonly userAccessRepository: UserAccessRepository,
    @Inject(PROPERTY_REPOSITORY) private readonly propertyRepository: PropertyRepository,
    @Inject(OUTLET_REPOSITORY) private readonly outletRepository: OutletRepository,
    @Inject(INVITE_TOKEN_REPOSITORY) private readonly inviteTokenRepository: InviteTokenRepository,
    @Inject(OTP_DISPATCHER) private readonly otpDispatcher: OtpDispatcher,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Auto-scoped to the caller's own effective access (spec: FR-14 GET
   * /users) — reuses the same "union of reachable chain/property/outlet ids
   * -> matching UserAccess rows" pattern as FR-13's 2FA policy toggle. */
  async listUsers(request: RequestWithAccess) {
    const access = request.effectiveAccess!;
    const chainIds = access.grants.filter((g) => g.scopeType === 'CHAIN').map((g) => g.scopeId);
    const directPropertyIds = access.grants
      .filter((g) => g.scopeType === 'PROPERTY')
      .map((g) => g.scopeId);
    const propertyIdsFromChains = (
      await Promise.all(chainIds.map((id) => this.propertyRepository.findIdsByChainId(id)))
    ).flat();
    const propertyIds = Array.from(new Set([...directPropertyIds, ...propertyIdsFromChains]));

    const [chainUserIds, propertyUserIds, outletUserIds] = await Promise.all([
      this.userAccessRepository.findUserIdsByScope('CHAIN', chainIds),
      this.userAccessRepository.findUserIdsByScope('PROPERTY', propertyIds),
      this.userAccessRepository.findUserIdsByScope('OUTLET', access.effectiveOutletIds),
    ]);
    const userIds = Array.from(new Set([...chainUserIds, ...propertyUserIds, ...outletUserIds]));

    const users = await Promise.all(userIds.map((id) => this.userRepository.findById(id)));
    return users.filter((u): u is User => !!u).map((u) => this.toSummary(u));
  }

  async inviteUser(request: RequestWithAccess, dto: InviteUserDto): Promise<{ userId: string }> {
    for (const grant of dto.grants) this.assertCallerCanGrant(request, grant);

    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) throw new ConflictException('A user with this email already exists');

    // isActive: false, no passwordHash yet — spec's invite business logic.
    const user = await this.userRepository.create({
      email: dto.email,
      phone: dto.phone,
      isActive: false,
    });
    for (const grant of dto.grants) {
      await this.userAccessRepository.create({
        userId: user.id,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
        role: grant.role,
      });
    }
    await this.dispatchInvite(user);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'INVITE_USER',
      entityType: 'User',
      entityId: user.id,
      after: { email: dto.email, grants: dto.grants },
    });
    return { userId: user.id };
  }

  async resendInvite(request: RequestWithAccess, userId: string): Promise<{ sent: true }> {
    await this.assertCallerCanManageTarget(request, userId);
    const user = await this.getUserOrThrow(userId);
    if (user.passwordHash) {
      throw new BadRequestException('User has already accepted their invite');
    }
    await this.dispatchInvite(user);
    return { sent: true };
  }

  /** Public (no bearer token yet) — see AuthController's equivalent
   * forced-flow routes. Reuses AuthService.completeLoginFlow so a freshly
   * activated user goes through the same 2FA-enforcement check as any other
   * first login (spec: "the invite-acceptance flow routes the new user
   * through mandatory 2FA enrollment before they reach the app"). */
  async acceptInvite(rawToken: string, dto: AcceptInviteDto): Promise<LoginResponse> {
    const hash = this.tokenService.hashOpaqueToken(rawToken);
    const stored = await this.inviteTokenRepository.findByTokenHash(hash);
    if (!stored || stored.usedAt) {
      throw new BadRequestException('Invite is invalid or has already been used');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Invite expired, request a new one');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.userRepository.update(stored.userId, { passwordHash, isActive: true });
    await this.inviteTokenRepository.markUsed(stored.id);
    return this.authService.completeLoginFlow(user);
  }

  async getUserDetail(request: RequestWithAccess, id: string) {
    await this.assertCallerCanManageTarget(request, id);
    const user = await this.getUserOrThrow(id);
    const grants = await this.userAccessRepository.findByUserId(id);
    return { ...this.toSummary(user), grants };
  }

  async updateAccess(request: RequestWithAccess, id: string, dto: UpdateAccessDto): Promise<void> {
    await this.assertCallerCanManageTarget(request, id);
    const before = await this.userAccessRepository.findByUserId(id);

    for (const grant of dto.add ?? []) {
      this.assertCallerCanGrant(request, grant);
      await this.userAccessRepository.create({
        userId: id,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
        role: grant.role,
      });
    }
    for (const grantId of dto.removeGrantIds ?? []) {
      const target = before.find((g) => g.id === grantId);
      // Can only revoke a grant the caller itself has coverage over — same
      // rule as granting it in the first place.
      if (target) this.assertCallerCanGrant(request, target);
      await this.userAccessRepository.remove(grantId);
    }

    const after = await this.userAccessRepository.findByUserId(id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_USER_ACCESS',
      entityType: 'User',
      entityId: id,
      before,
      after,
    });
  }

  /** Soft-delete only — historical records keep pointing at this (now
   * inactive) user; login is blocked immediately both by `isActive: false`
   * and by revoking any already-issued sessions. */
  async deactivate(request: RequestWithAccess, id: string): Promise<void> {
    await this.assertCallerCanManageTarget(request, id);
    const before = await this.getUserOrThrow(id);
    const after = await this.userRepository.update(id, { isActive: false });
    await this.authService.logoutAll(id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'DEACTIVATE_USER',
      entityType: 'User',
      entityId: id,
      before,
      after,
    });
  }

  async adminResetPassword(
    request: RequestWithAccess,
    id: string,
    dto: AdminReauthDto,
  ): Promise<void> {
    await this.assertCallerCanManageTarget(request, id);
    await this.assertAdminReauth(request.user!.id, dto);
    const target = await this.getUserOrThrow(id);
    await this.authService.issuePasswordResetToken(target);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'ADMIN_RESET_PASSWORD',
      entityType: 'User',
      entityId: id,
    });
  }

  async adminReset2fa(request: RequestWithAccess, id: string, dto: AdminReauthDto): Promise<void> {
    await this.assertCallerCanManageTarget(request, id);
    await this.assertAdminReauth(request.user!.id, dto);
    await this.twoFactorService.adminReset(id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'ADMIN_RESET_2FA',
      entityType: 'User',
      entityId: id,
    });
  }

  async getAuditLog(request: RequestWithAccess, id: string) {
    await this.assertCallerCanManageTarget(request, id);
    return this.auditLogService.findByUserId(id);
  }

  private async dispatchInvite(user: User): Promise<void> {
    await this.inviteTokenRepository.invalidateUnusedForUser(user.id);
    const raw = this.tokenService.generateOpaqueToken();
    await this.inviteTokenRepository.create({
      userId: user.id,
      tokenHash: this.tokenService.hashOpaqueToken(raw),
      expiresAt: this.tokenService.inviteTokenExpiry(),
    });
    await this.otpDispatcher.dispatch({ destination: user.email, method: 'EMAIL', code: raw, purpose: 'INVITE' });
  }

  private toSummary(user: User) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      status: !user.passwordHash ? 'INVITED' : user.isActive ? 'ACTIVE' : 'DEACTIVATED',
      preferredLanguage: user.preferredLanguage,
      lastLoginAt: user.lastLoginAt,
    };
  }

  /** "The inviting user cannot grant a scope broader than their own
   * effective access" — the caller must have SOME role covering the exact
   * scope being granted (or revoked). */
  private assertCallerCanGrant(
    request: RequestWithAccess,
    grant: { scopeType: ScopeType; scopeId: string },
  ): void {
    if (!this.resolveRoleForGrantScope(request, grant)) {
      throw new ForbiddenException(
        `Cannot grant access to ${grant.scopeType} ${grant.scopeId} — outside your own effective access`,
      );
    }
  }

  private async assertCallerCanManageTarget(
    request: RequestWithAccess,
    targetUserId: string,
  ): Promise<void> {
    const targetGrants = await this.userAccessRepository.findByUserId(targetUserId);
    const covered = targetGrants.some((g) => this.resolveRoleForGrantScope(request, g));
    if (!covered) {
      throw new ForbiddenException('No access to manage this user');
    }
  }

  private resolveRoleForGrantScope(
    request: RequestWithAccess,
    grant: { scopeType: ScopeType; scopeId: string },
  ) {
    const access = request.effectiveAccess;
    return grant.scopeType === 'CHAIN'
      ? access?.roleForChain(grant.scopeId)
      : grant.scopeType === 'PROPERTY'
        ? access?.roleForProperty(grant.scopeId)
        : access?.roleForOutlet(grant.scopeId);
  }

  private async assertAdminReauth(adminUserId: string, dto: AdminReauthDto): Promise<void> {
    const admin = await this.getUserOrThrow(adminUserId);
    if (!admin.passwordHash || !(await this.passwordService.verify(dto.password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid password');
    }
    if (!(await this.twoFactorService.verifyCurrentCode(adminUserId, dto.code))) {
      throw new UnauthorizedException(
        'Invalid or missing 2FA code — this action requires the admin to have 2FA enabled',
      );
    }
  }

  private async getUserOrThrow(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
