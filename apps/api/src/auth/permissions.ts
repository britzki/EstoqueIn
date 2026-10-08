import type { Role } from '@prisma/client';

export const PERMISSIONS = [
  'products:write',
  'products:import',
  'suppliers:write',
  'warehouses:write',
  'stock:move',
  'stock:adjust',
  'inventory:count',
  'inventory:manage',
  'alerts:ack',
  'reports:read',
  'sales:create',
  'sales:cancel',
  'settings:manage',
  'audit:read',
  'bills:manage',
  'users:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Matriz de permissões por perfil.
 * - ADMIN: tudo, inclusive gestão de usuários
 * - MANAGER: cadastros, ajustes, inventário, relatórios, cancelar vendas, configurações da loja e contas a pagar
 * - OPERATOR: operação do dia a dia (vendas, entradas, saídas, transferências, contagem)
 * - VIEWER: somente leitura de estoque e cadastros (relatórios e valores são só de administrador e gerente)
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MANAGER: PERMISSIONS.filter((permission) => permission !== 'users:manage'),
  OPERATOR: ['stock:move', 'inventory:count', 'alerts:ack', 'sales:create'],
  // Consulta estoque e cadastros, sem relatórios nem números do negócio.
  VIEWER: [],
};

export const permissionsFor = (role: Role): Permission[] => [...ROLE_PERMISSIONS[role]];

export const can = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);
