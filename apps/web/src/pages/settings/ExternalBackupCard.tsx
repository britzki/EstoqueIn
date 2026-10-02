import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, FolderOpen, HardDriveUpload } from 'lucide-react';
import { desktop, type ExternalBackupStatus } from '../../lib/desktop';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { Button, Card, CardHeader } from '../../components/ui';

/**
 * Cópia diária do banco para fora do computador. Só existe no programa instalado:
 * quem escolhe a pasta e copia o arquivo é o Windows, não a página.
 */
export function ExternalBackupCard() {
  const toast = useToast();
  const [status, setStatus] = useState<ExternalBackupStatus | null>(null);
  const [busy, setBusy] = useState<'choose' | 'run' | 'clear' | null>(null);

  useEffect(() => {
    desktop
      ?.getExternalBackup()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  if (!desktop || !status) return null;

  const run = async (action: 'choose' | 'run' | 'clear') => {
    setBusy(action);
    try {
      const next =
        action === 'choose'
          ? await desktop!.chooseExternalBackup()
          : action === 'run'
            ? await desktop!.runExternalBackup()
            : await desktop!.clearExternalBackup();
      setStatus(next);
      if (action !== 'clear' && next.dir) {
        if (next.lastError) toast.error('A cópia não foi feita', next.lastError);
        else toast.success('Cópia de segurança salva', next.dir);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Cópia de segurança fora do computador"
        description="Se o computador estragar ou for roubado, os dados estão salvos em outro lugar."
      />
      <div className="space-y-4 p-5 text-sm">
        {status.dir ? (
          <>
            <div className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <FolderOpen className="mt-0.5 size-4 shrink-0 text-slate-500" />
              <div className="min-w-0">
                <p className="font-medium break-all text-slate-800">{status.dir}</p>
                <p className="text-slate-500">
                  Uma cópia por dia, guardando as 7 últimas.{' '}
                  {status.lastAt
                    ? `Última: ${formatDateTime(status.lastAt)} (${formatRelative(status.lastAt)}).`
                    : 'Nenhuma cópia feita ainda.'}
                </p>
              </div>
            </div>
            {status.lastError ? (
              <p className="flex items-start gap-2 text-red-700">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {status.lastError}. O sistema tenta de novo a cada hora.
              </p>
            ) : status.lastAt ? (
              <p className="flex items-center gap-2 text-emerald-700">
                <CircleCheck className="size-4" /> Funcionando.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<HardDriveUpload className="size-4" />}
                loading={busy === 'run'}
                onClick={() => run('run')}
              >
                Copiar agora
              </Button>
              <Button variant="secondary" size="sm" loading={busy === 'choose'} onClick={() => run('choose')}>
                Trocar pasta
              </Button>
              <Button variant="ghost" size="sm" loading={busy === 'clear'} onClick={() => run('clear')}>
                Desativar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-slate-600">
              Escolha um pendrive que fique sempre conectado ou uma pasta do Google Drive ou OneDrive (que envia para a
              internet sozinha). Os backups que o sistema já faz ficam no próprio computador.
            </p>
            <Button
              icon={<HardDriveUpload className="size-4" />}
              loading={busy === 'choose'}
              onClick={() => run('choose')}
            >
              Escolher pasta
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
