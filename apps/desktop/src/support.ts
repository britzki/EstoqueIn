/** Suporte: arquivo de diagnóstico e recuperação da senha do administrador. */
import { app, dialog, shell } from 'electron';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { arch, release } from 'node:os';
import { join } from 'node:path';
import { externalBackupStatus } from './backups.js';
import { readLogTail } from './logging.js';
import { backupsDir, dataDir, dbPath, fileStamp } from './paths.js';
import { runtime } from './runtime.js';

/** WhatsApp do suporte (o mesmo da central de ajuda, em apps/web/src/lib/support.ts). */
const SUPPORT_WHATSAPP = '5511989045896';
export const SUPPORT_WHATSAPP_LABEL = '(11) 98904-5896';

export const supportChatUrl = () =>
  `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(`Olá! Preciso de ajuda com o EstoqueIn.\nVersão: ${app.getVersion()}`)}`;

const fileSize = (file: string) => (existsSync(file) ? `${(statSync(file).size / 1024).toFixed(0)} KB` : 'não existe');

/** Backups locais, do mais novo para o mais antigo (pela data do arquivo, não pelo nome). */
function localBackups() {
  return readdirSync(backupsDir)
    .filter((file) => file.endsWith('.db'))
    .map((file) => ({ file, time: statSync(join(backupsDir, file)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
}

/**
 * Gera um .txt com o que o suporte precisa para entender um problema: versões, estado do banco
 * e o final do log. Não leva o banco nem senhas; o log pode citar nomes de produtos (alertas de estoque).
 */
export async function generateDiagnostics() {
  const { serverModule, mainWindow } = runtime;
  if (!serverModule || !mainWindow) return;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar arquivo de diagnóstico',
    defaultPath: join(app.getPath('desktop'), `estoquein-diagnostico-${fileStamp()}.txt`),
    filters: [{ name: 'Texto', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return;

  const section = (title: string, lines: string[]) => `=== ${title} ===\n${lines.join('\n')}\n`;
  let database: string;
  try {
    database = JSON.stringify(await serverModule.getDiagnostics(), null, 2);
  } catch (error) {
    database = `Erro ao consultar o banco: ${String(error)}`;
  }
  const backups = localBackups();
  const external = externalBackupStatus();

  const report = [
    section('Programa', [
      `EstoqueIn ${app.getVersion()} (Electron ${process.versions.electron})`,
      `Windows ${release()} ${arch()}`,
      `Gerado em ${new Date().toLocaleString('pt-BR')}`,
      `Porta da API: ${runtime.server?.port ?? 'parada'}`,
      `Pasta de dados: ${dataDir}`,
      `Banco: ${fileSize(dbPath)} (WAL ${fileSize(`${dbPath}-wal`)})`,
    ]),
    section('Backups', [
      `Locais: ${backups.length}${backups[0] ? `, mais recente ${backups[0].file}` : ''}`,
      `Cópia externa: ${external.dir ?? 'não configurada'}`,
      `Última cópia externa: ${external.lastAt ?? 'nunca'}`,
      `Último erro da cópia externa: ${external.lastError ?? 'nenhum'}`,
    ]),
    section('Banco de dados', [database]),
    section('Log (últimas linhas)', [readLogTail(300)]),
  ].join('\n');

  writeFileSync(filePath, report);
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Diagnóstico gerado',
    message: 'Arquivo de diagnóstico salvo.',
    detail: `Envie este arquivo para o suporte. Ele não contém o banco de dados nem dados de clientes.\n\n${filePath}`,
    buttons: ['OK', 'Mostrar na pasta'],
  });
  if (response === 1) shell.showItemInFolder(filePath);
}

/**
 * Para quem esqueceu a senha do administrador. Só é alcançável por quem está no computador
 * da loja, dentro da sessão do Windows; por isso a senha do Windows é parte da proteção.
 */
export async function resetAdminPassword() {
  const { serverModule, mainWindow } = runtime;
  if (!serverModule || !mainWindow) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Redefinir senha do administrador',
    message: 'Gerar uma senha temporária para o administrador?',
    detail:
      'A senha atual deixa de funcionar. A nova senha aparece na próxima tela e precisa ser trocada no primeiro acesso. A redefinição fica no registro de alterações.',
    buttons: ['Gerar senha temporária', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;

  const result = await serverModule.resetAdminPassword('menu do programa');
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Senha temporária gerada',
    message: `Senha temporária: ${result.temporaryPassword}`,
    detail: `Usuário: ${result.email} (${result.name})\n\nAnote agora: ela não será mostrada de novo. Ao entrar, o sistema pede uma senha nova.`,
    buttons: ['Já anotei'],
  });
  mainWindow.webContents.reload();
}
