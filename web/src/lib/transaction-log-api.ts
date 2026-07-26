import { apiClient } from './api-client';

export interface ApiTransactionLogEntry {
  id: string;
  entityCategory: 'MASTER_DATA' | 'TRANSACTIONAL';
  entityType: string;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | null;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  summary: string;
  createdAt: string;
}

/** Thin wrapper over FR-18's GET /transaction-log — used by the Item Detail
 * screen's History tab, filtered to one item's field-level change history. */
export const transactionLogApi = {
  listForEntity: (entityType: string, entityId: string) =>
    apiClient.get<ApiTransactionLogEntry[]>(
      `/transaction-log?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
    ),
};
