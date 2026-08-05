import { apiClient } from './api-client';

export interface ApiUserProfile {
  id: string;
  email: string;
  preferredLanguage: string;
  preferredCurrency: string;
  twoFactorEnabled: boolean;
  twoFactorMethod: string | null;
  effectiveRole: string | undefined;
  effectiveOutletIds: string[];
}

/** Mirrors src/auth/services/auth-responses.ts. */
export interface LoginSuccessResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    preferredLanguage: string;
    effectiveRole: string | undefined;
    effectiveOutletIds: string[];
  };
  /** Only present when `trustDevice: true` was sent to 2fa/verify or 2fa/backup-code. */
  trustedDeviceToken?: string;
}

export interface RequiresTwoFactorResponse {
  requiresTwoFactor: true;
  pendingTwoFactorToken: string;
  method: 'TOTP' | 'SMS' | 'EMAIL';
  maskedDestination: string | null;
}

export interface RequiresTwoFactorEnrollmentResponse {
  requiresTwoFactorEnrollment: true;
  pendingEnrollmentToken: string;
}

export type LoginResponse =
  | LoginSuccessResponse
  | RequiresTwoFactorResponse
  | RequiresTwoFactorEnrollmentResponse;

export function isTwoFactorRequired(r: LoginResponse): r is RequiresTwoFactorResponse {
  return 'requiresTwoFactor' in r;
}

export function isEnrollmentRequired(r: LoginResponse): r is RequiresTwoFactorEnrollmentResponse {
  return 'requiresTwoFactorEnrollment' in r;
}

export interface LoginRequest {
  email: string;
  password: string;
  trustedDeviceToken?: string;
}

export interface VerifyTwoFactorRequest {
  pendingTwoFactorToken: string;
  code: string;
  trustDevice?: boolean;
  deviceLabel?: string;
}

export interface BackupCodeRequest {
  pendingTwoFactorToken: string;
  backupCode: string;
  trustDevice?: boolean;
  deviceLabel?: string;
}

export const authApi = {
  login: (body: LoginRequest) => apiClient.post<LoginResponse>('/auth/login', body),

  verifyTwoFactor: (body: VerifyTwoFactorRequest) =>
    apiClient.post<LoginSuccessResponse>('/auth/2fa/verify', body),

  resendTwoFactor: (pendingTwoFactorToken: string) =>
    apiClient.post<{ sent: true }>('/auth/2fa/resend', { pendingTwoFactorToken }),

  loginWithBackupCode: (body: BackupCodeRequest) =>
    apiClient.post<LoginSuccessResponse>('/auth/2fa/backup-code', body),

  forgotPassword: (email: string) =>
    apiClient.post<{ sent: true }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, newPassword: string) =>
    apiClient.post<{ success: true }>('/auth/reset-password', { token, newPassword }),

  me: () => apiClient.get<ApiUserProfile>('/auth/me'),

  logout: (refreshToken: string) =>
    apiClient.post<{ success: boolean }>('/auth/logout', { refreshToken }),
};
