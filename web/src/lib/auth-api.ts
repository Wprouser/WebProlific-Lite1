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

export const authApi = {
  me: () => apiClient.get<ApiUserProfile>('/auth/me'),
  logout: (refreshToken: string) => apiClient.post<{ success: boolean }>('/auth/logout', { refreshToken }),
};
