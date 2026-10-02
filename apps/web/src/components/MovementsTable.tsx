import { Link } from 'react-router';
import clsx from 'clsx';
import { MOVEMENT_LABEL, MOVEMENT_TONE, formatDateTime, formatNumber } from '../lib/format';
import type { Movement } from '../lib/types';
import { Badge, Table, Td, Th } from './ui';

export function MovementsTable({ movements, showProduct = true }: { movements: Movement[]; showProduct?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Data</Th>
          <Th>Tipo</Th>
          {showProduct && <Th>Produto</Th>}
          <Th>Estoque</Th>
          <Th className="text-right">Qtd.</Th>
          <Th className="text-right">Saldo após</Th>
          <Th className="hidden lg:table-cell">Documento / motivo</Th>
          <Th className="hidden md:table-cell">Usuário</Th>
        </tr>
      </thead>
      <tbody>
        {movements.map((movement) => (
          <tr key={movement.id} className="hover:bg-slate-50">
            <Td className="whitespace-nowrap text-slate-500 tabular-nums">{formatDateTime(movement.createdAt)}</Td>
            <Td>
              <Badge tone={MOVEMENT_TONE[movement.type]}>{MOVEMENT_LABEL[movement.type]}</Badge>
            </Td>
            {showProduct && (
              <Td className="max-w-64">
                <Link
                  to={`/products/${movement.product.id}`}
                  className="block truncate font-medium text-slate-900 hover:underline"
                >
                  {movement.product.name}
                </Link>
                {movement.product.sku && <span className="text-xs text-slate-500">{movement.product.sku}</span>}
              </Td>
            )}
            <Td className="whitespace-nowrap">{movement.warehouse.name}</Td>
            <Td
              className={clsx(
                'text-right font-medium tabular-nums',
                movement.quantity > 0 ? 'text-emerald-700' : 'text-slate-900',
              )}
            >
              {movement.quantity > 0 ? '+' : ''}
              {formatNumber(movement.quantity)}
            </Td>
            <Td className="text-right tabular-nums">{formatNumber(movement.balanceAfter)}</Td>
            <Td className="hidden max-w-64 truncate text-slate-500 lg:table-cell">
              {[movement.documentRef, movement.supplier?.name, movement.reason].filter(Boolean).join(' · ') || '—'}
            </Td>
            <Td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{movement.user.name}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
