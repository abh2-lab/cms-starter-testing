import { apiFetch } from '@/lib/api';

export interface TourCompleteResponse {
  tourCompletedAt: string;
}

export const meApi = {
  completeTour: () =>
    apiFetch<TourCompleteResponse>('/admin/me/tour/complete', {
      method: 'POST',
    }),
};
