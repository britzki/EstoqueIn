import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signToken } from '../src/auth/tokens.js';
import { clearDatabase } from '../src/modules/setup/demo-data.js';

export const app = createApp();
export const api = () => request(app);

/** Banco vazio antes de cada teste (mesma limpeza da demonstração). */
export const resetDatabase = clearDatabase;

export async function createUser(role: Role, password = 'Senha@123') {
  const user = await prisma.user.create({
    data: {
      name: `Usuário ${role}`,
      email: `${role.toLowerCase()}@teste.dev`,
      role,
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  const token = signToken(user);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

/** Cenário básico: um produto (mínimo 10), um depósito e uma loja. */
export async function createScenario() {
  const admin = await createUser('ADMIN');
  const operator = await createUser('OPERATOR');
  const viewer = await createUser('VIEWER');

  const depot = await prisma.warehouse.create({ data: { code: 'CD', name: 'Depósito' } });
  const store = await prisma.warehouse.create({ data: { code: 'LJ', name: 'Loja' } });
  const supplier = await prisma.supplier.create({ data: { name: 'Fornecedor Teste', document: '12.345.678/0001-00' } });
  const product = await prisma.product.create({
    data: { sku: 'CAF-500', name: 'Café 500g', barcode: '7891234567895', minStock: 10, costCents: 0 },
  });

  return { admin, operator, viewer, depot, store, supplier, product };
}

export const stockOf = async (productId: string, warehouseId: string) =>
  (await prisma.stockLevel.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } }))?.quantity ?? 0;
