import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { permissionsFor } from '../../auth/permissions.js';
import { signToken } from '../../auth/tokens.js';
import { DEMO_ACCOUNTS, loadDemoData } from './demo-data.js';

/**
 * Configuração inicial (primeira execução, sem nenhum usuário cadastrado).
 * Rotas públicas, mas que só funcionam enquanto o sistema ainda não foi configurado.
 */
export const setupRoutes = Router();

const freshSchema = z.object({
  mode: z.literal('fresh'),
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres').max(72),
  warehouseName: z.string().trim().min(2, 'Informe o nome do estoque').max(100).default('Estoque principal'),
});

const setupSchema = z.discriminatedUnion('mode', [freshSchema, z.object({ mode: z.literal('demo') })]);

const alreadyConfigured = () => new AppError(409, 'O sistema já foi configurado', 'ALREADY_CONFIGURED');

const DEMO_DOMAIN = 'estoquein.dev';
const LEGACY_DEMO_DOMAIN = 'stockflow.dev';

let running = false;

setupRoutes.get('/status', async (_req, res) => {
  const [users, demoUser] = await Promise.all([
    prisma.user.count(),
    // Demonstrações carregadas antes da troca de nome do produto usam o domínio antigo.
    prisma.user.findFirst({
      where: {
        email: { in: [DEMO_ACCOUNTS[0].email, DEMO_ACCOUNTS[0].email.replace(DEMO_DOMAIN, LEGACY_DEMO_DOMAIN)] },
      },
      select: { email: true },
    }),
  ]);
  const domain = demoUser?.email.split('@')[1];
  res.json({
    needsSetup: users === 0,
    // A tela de login só mostra as contas de demonstração quando elas existem.
    demoAccounts: demoUser
      ? DEMO_ACCOUNTS.map((account) => ({ ...account, email: account.email.replace(DEMO_DOMAIN, domain!) }))
      : [],
  });
});

setupRoutes.post('/', async (req, res) => {
  const input = setupSchema.parse(req.body);
  if (running) throw alreadyConfigured();
  running = true;

  try {
    if ((await prisma.user.count()) > 0) throw alreadyConfigured();

    if (input.mode === 'demo') {
      const summary = await loadDemoData();
      res.status(201).json({ mode: 'demo', summary, demoAccounts: DEMO_ACCOUNTS });
      return;
    }

    const user = await prisma.$transaction(async (tx) => {
      const admin = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: 'ADMIN',
          passwordHash: await bcrypt.hash(input.password, 10),
        },
      });
      if ((await tx.warehouse.count()) === 0) {
        await tx.warehouse.create({ data: { code: 'PRINCIPAL', name: input.warehouseName } });
      }
      return admin;
    });

    // Já devolve a sessão: o administrador entra direto no sistema.
    res.status(201).json({
      mode: 'fresh',
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      permissions: permissionsFor(user.role),
    });
  } finally {
    running = false;
  }
});
