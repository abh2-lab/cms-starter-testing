import { apiFetch } from '@/lib/api';

export interface Menu {
  id: string;
  tenantId: string | null;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItem {
  id: string;
  tenantId: string | null;
  menuId: string;
  parentId: string | null;
  label: string;
  url: string | null;
  contentId: string | null;
  openInNewTab: boolean;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  attributes: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface MenuDetail extends Menu {
  items: MenuItem[];
}

export interface CreateMenuInput {
  name: string;
  slug: string;
  description?: string | null;
  isActive?: boolean;
}
export type UpdateMenuInput = Partial<CreateMenuInput>;

export interface CreateMenuItemInput {
  label: string;
  url?: string | null;
  contentId?: string | null;
  parentId?: string | null;
  openInNewTab?: boolean;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}
export type UpdateMenuItemInput = Partial<CreateMenuItemInput>;

export interface ReorderItem {
  id: string;
  sortOrder: number;
  parentId: string | null;
}

export const menusApi = {
  list: () => apiFetch<{ data: Menu[] }>('/admin/menus'),
  get: (id: string) => apiFetch<{ data: MenuDetail }>(`/admin/menus/${id}`),
  create: (input: CreateMenuInput) =>
    apiFetch<{ data: Menu }>('/admin/menus', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateMenuInput) =>
    apiFetch<{ data: Menu }>(`/admin/menus/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiFetch<null>(`/admin/menus/${id}`, { method: 'DELETE' }),

  createItem: (menuId: string, input: CreateMenuItemInput) =>
    apiFetch<{ data: MenuItem }>(`/admin/menus/${menuId}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateItem: (menuId: string, itemId: string, input: UpdateMenuItemInput) =>
    apiFetch<{ data: MenuItem }>(`/admin/menus/${menuId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeItem: (menuId: string, itemId: string) =>
    apiFetch<null>(`/admin/menus/${menuId}/items/${itemId}`, {
      method: 'DELETE',
    }),
  reorderItems: (menuId: string, items: ReorderItem[]) =>
    apiFetch<{ data: { ok: boolean } }>(`/admin/menus/${menuId}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
};
