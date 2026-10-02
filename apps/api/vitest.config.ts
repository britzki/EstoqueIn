import { defineConfig } from 'vitest/config';

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test.db',
  JWT_SECRET: 'segredo-de-teste-com-tamanho-suficiente',
  ALERT_WEBHOOK_URL: '',
  BARCODE_LOOKUP_ENABLED: 'true',
};

export default defineConfig({
  test: {
    env: TEST_ENV,
    globalSetup: './tests/global-setup.ts',
    // Os testes compartilham um banco SQLite, então rodam em sequência.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
