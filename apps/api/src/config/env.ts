import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const isValidTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
};

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
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+\s*(ms|s|m|h|d|w|y)?$/, 'Use, por exemplo, 8h, 30m ou 1d')
    .default('8h'),
  APP_TIMEZONE: z
    .string()
    .refine(isValidTimeZone, 'Fuso horário desconhecido (ex.: America/Sao_Paulo)')
    .default('America/Sao_Paulo'),
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
