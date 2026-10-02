/**
 * Monta a pasta dist/ do app desktop:
 *   main.cjs     processo principal do Electron
 *   preload.cjs  ponte segura entre a interface e o programa (impressão da notinha)
 *   server.cjs   API inteira (Express + Prisma Client) num único arquivo
 *   engine/      motor nativo do Prisma (fica fora do .asar)
 *   migrations/  migrations SQL aplicadas na inicialização
 *   web/         interface React compilada
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const here = import.meta.dirname;
const root = join(here, '..', '..');
const apiDir = join(root, 'apps', 'api');
const webDir = join(root, 'apps', 'web');
const out = join(here, 'dist');
const production = process.argv.includes('--production');
const prismaClientDir = join(root, 'node_modules', '.prisma', 'client');

const step = (message) => console.info(`\n› ${message}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'engine'), { recursive: true });

if (!existsSync(join(prismaClientDir, 'index.js'))) {
  step('Gerando Prisma Client');
  execSync('npx prisma generate', { cwd: apiDir, stdio: 'inherit' });
}

step('Compilando a interface (apps/web)');
execSync('npm run build -w @estoquein/web', { cwd: root, stdio: 'inherit' });

step('Copiando interface, migrations, motor do banco e ícone');
cpSync(join(webDir, 'dist'), join(out, 'web'), { recursive: true });
cpSync(join(apiDir, 'prisma', 'migrations'), join(out, 'migrations'), { recursive: true });
for (const file of readdirSync(prismaClientDir).filter((f) => f.startsWith('query_engine') && f.endsWith('.node'))) {
  cpSync(join(prismaClientDir, file), join(out, 'engine', file));
}
cpSync(join(here, 'build', 'icon.png'), join(out, 'icon.png'));

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: !production,
  minify: production,
  legalComments: 'none',
  logLevel: 'warning',
};

step('Empacotando processo principal');
await build({
  ...common,
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(out, 'main.cjs'),
  external: ['electron'],
});

await build({
  ...common,
  entryPoints: [join(here, 'src', 'preload.ts')],
  outfile: join(out, 'preload.cjs'),
  external: ['electron'],
});

step('Empacotando a API');
await build({
  ...common,
  entryPoints: [join(apiDir, 'src', 'desktop', 'index.ts')],
  outfile: join(out, 'server.cjs'),
  plugins: [
    {
      // Usa o Prisma Client já gerado para o schema do projeto, embutido no bundle.
      name: 'prisma-client',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^@prisma\/client$/ }, () => ({ path: join(prismaClientDir, 'index.js') }));
      },
    },
  ],
});

console.info(`\n✔ dist/ pronto${production ? ' (produção)' : ''}`);
