import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RbacModule } from '../rbac/rbac.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { TwoFactorService } from './services/two-factor.service';
import { TokenService } from './services/token.service';
import { TotpService } from './services/totp.service';
import { PasswordService } from './services/password.service';
import {
  ConsoleOtpDispatcherService,
  EmailOtpDispatcher,
  OTP_DISPATCHER,
  OtpDispatcher,
} from './services/otp-dispatcher.service';
import { EmailModule } from '../email/email.module';
import { EMAIL_PROVIDER } from '../email/providers/tokens';
import { EmailProvider } from '../email/providers/email.provider';
import { DevEmailProvider } from '../email/providers/dev-email.provider';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PerUserThrottlerGuard } from './guards/per-user-throttler.guard';
import {
  USER_REPOSITORY,
  TWO_FACTOR_AUTH_REPOSITORY,
  TWO_FACTOR_BACKUP_CODE_REPOSITORY,
  TWO_FACTOR_CHALLENGE_REPOSITORY,
  TRUSTED_DEVICE_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  PASSWORD_RESET_TOKEN_REPOSITORY,
} from './repositories/tokens';
import { PrismaUserRepository } from './repositories/prisma/prisma-user.repository';
import { PrismaTwoFactorAuthRepository } from './repositories/prisma/prisma-two-factor-auth.repository';
import { PrismaTwoFactorBackupCodeRepository } from './repositories/prisma/prisma-two-factor-backup-code.repository';
import { PrismaTwoFactorChallengeRepository } from './repositories/prisma/prisma-two-factor-challenge.repository';
import { PrismaTrustedDeviceRepository } from './repositories/prisma/prisma-trusted-device.repository';
import { PrismaRefreshTokenRepository } from './repositories/prisma/prisma-refresh-token.repository';
import { PrismaPasswordResetTokenRepository } from './repositories/prisma/prisma-password-reset-token.repository';

@Module({
  imports: [
    ConfigModule,
    TenancyModule,
    RbacModule,
    ActivityLogModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 15 * 60 * 1000, limit: 20 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TwoFactorService,
    TokenService,
    TotpService,
    PasswordService,
    JwtAuthGuard,
    PerUserThrottlerGuard,
    {
      // Follows whatever EmailModule resolved: with a real provider
      // configured, codes are emailed; with the dev stub, they keep going to
      // the console (where the seed scripts tell you to look for them) rather
      // than being handed to a sender that only logs anyway.
      provide: OTP_DISPATCHER,
      inject: [EMAIL_PROVIDER, ConfigService],
      useFactory: (emailProvider: EmailProvider, config: ConfigService): OtpDispatcher =>
        emailProvider instanceof DevEmailProvider
          ? new ConsoleOtpDispatcherService()
          : new EmailOtpDispatcher(emailProvider, config),
    },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: TWO_FACTOR_AUTH_REPOSITORY, useClass: PrismaTwoFactorAuthRepository },
    { provide: TWO_FACTOR_BACKUP_CODE_REPOSITORY, useClass: PrismaTwoFactorBackupCodeRepository },
    { provide: TWO_FACTOR_CHALLENGE_REPOSITORY, useClass: PrismaTwoFactorChallengeRepository },
    { provide: TRUSTED_DEVICE_REPOSITORY, useClass: PrismaTrustedDeviceRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PrismaRefreshTokenRepository },
    { provide: PASSWORD_RESET_TOKEN_REPOSITORY, useClass: PrismaPasswordResetTokenRepository },
  ],
  exports: [
    AuthService,
    TwoFactorService,
    TokenService,
    PasswordService,
    JwtAuthGuard,
    USER_REPOSITORY,
    OTP_DISPATCHER,
  ],
})
export class AuthModule {}
