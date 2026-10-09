import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET precisa ter pelo menos 16 caracteres')
    // O valor de exemplo do .env.example é público: com ele, qualquer um forjaria um login.
    .refine(
      (value) => process.env.NODE_ENV !== 'production' || !value.startsWith('troque-este-segredo'),
      'Defina um JWT_SECRET próprio em produção',
    ),
  JWT_EXPIRES_IN: z.string().default('8h'),
  APP_TIMEZONE: z.string().default('America/Sao_Paulo'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  ALERT_WEBHOOK_URL: z.union([z.url(), z.literal('')]).default(''),
  BARCODE_LOOKUP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Datas "de hoje" e agrupamentos por dia seguem o fuso da empresa, não o do servidor.
process.env.TZ = env.APP_TIMEZONE;
