import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { HardDriveUpload, TriangleAlert } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { desktop, type ExternalBackupStatus } from '../lib/desktop';
import { formatRelative } from '../lib/format';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sem cópia externa há mais que isso (com o programa aberto), o aviso vira alerta. */
const STALE_DAYS = 2;

/**
 * Aviso na tela inicial quando a cópia de segurança fora do computador não está protegendo os dados:
 * não configurada, falhando (pendrive desconectado) ou parada há dias. Só no programa instalado
 * e só para quem pode mudar as configurações.
 */
export function BackupWarning() {
  const { can } = useAuth();
  const [status, setStatus] = useState<ExternalBackupStatus | null>(null);

  useEffect(() => {
    desktop
      ?.getExternalBackup()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  if (!desktop || !status || !can('settings:manage')) return null;

  const daysSince = status.lastAt ? (Date.now() - new Date(status.lastAt).getTime()) / DAY_MS : null;
  const failing = Boolean(status.dir) && (Boolean(status.lastError) || daysSince === null || daysSince > STALE_DAYS);

  if (status.dir && !failing) return null;

  if (!status.dir) {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <HardDriveUpload className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold text-amber-900">Seus dados só estão neste computador</p>
            <p className="text-sm text-amber-800">
              Se ele estragar ou for roubado, tudo se perde. Ative a cópia diária para um pendrive ou para o Google
              Drive/OneDrive.
            </p>
          </div>
        </div>
        <Link
          to="/settings"
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-700"
        >
          Configurar cópia
        </Link>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-red-600" />
        <div>
          <p className="font-semibold text-red-900">A cópia de segurança fora do computador não está sendo feita</p>
          <p className="text-sm text-red-800">
            {status.lastAt ? `Última cópia ${formatRelative(status.lastAt)}.` : 'Nenhuma cópia feita ainda.'}{' '}
            {status.lastError ? `Motivo: ${status.lastError}.` : ''} Confira se o pendrive está conectado ou se a pasta
            ainda existe.
          </p>
        </div>
      </div>
      <Link
        to="/settings"
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
      >
        Resolver
      </Link>
    </div>
  );
}
