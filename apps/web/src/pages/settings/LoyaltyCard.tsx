import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useCategories } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { formatNumber } from '../../lib/format';
import type { LoyaltyRule, Product } from '../../lib/types';
import { ProductPicker } from '../../components/ProductPicker';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorMessage,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from '../../components/ui';

/** Cartões fidelidade da loja: "a cada 10 sacos de ração, ganha 1 petisco". */
export function LoyaltyCard() {
  const [editing, setEditing] = useState<LoyaltyRule | 'new' | null>(null);
  const { data: rules, isLoading } = useQuery({
    queryKey: ['loyalty-rules'],
    queryFn: () => api.get<LoyaltyRule[]>('/loyalty-rules'),
  });

  return (
    <Card>
      <CardHeader
        title="Cartão fidelidade"
        description="O sistema conta as compras de cada cliente e avisa no caixa quando ele ganha o brinde."
        actions={
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Novo cartão
          </Button>
        }
      />
      <div className="p-5">
        {isLoading ? (
          <Spinner />
        ) : !rules?.length ? (
          <p className="text-sm text-slate-500">
            Nenhum cartão ainda. Exemplo: a cada 10 sacos de ração (categoria Rações), ganha 1 petisco.
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="flex items-start gap-2">
                  <Gift className="mt-0.5 size-4 shrink-0 text-brand-700" />
                  <span>
                    <span className="font-medium text-slate-900">{rule.name}</span>{' '}
                    {!rule.active && <Badge>Desativado</Badge>}
                    <span className="block text-slate-500">
                      A cada {formatNumber(rule.requiredQuantity)}{' '}
                      {rule.product ? `${rule.product.unit} de ${rule.product.name}` : `da categoria ${rule.category}`},
                      ganha {formatNumber(rule.rewardQuantity)} {rule.rewardProduct.name}
                    </span>
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}>
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <RuleModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RuleModal({ rule, onClose }: { rule: LoyaltyRule | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: categories = [] } = useCategories();
  const [name, setName] = useState(rule?.name ?? '');
  const [countBy, setCountBy] = useState<'category' | 'product'>(rule?.productId ? 'product' : 'category');
  const [category, setCategory] = useState(rule?.category ?? '');
  const [product, setProduct] = useState<Pick<Product, 'id' | 'name' | 'sku' | 'barcode'> | null>(
    rule?.product ? { id: rule.product.id, name: rule.product.name, sku: '', barcode: null } : null,
  );
  const [required, setRequired] = useState(rule ? String(rule.requiredQuantity) : '10');
  const [reward, setReward] = useState<Pick<Product, 'id' | 'name' | 'sku' | 'barcode'> | null>(
    rule ? { id: rule.rewardProduct.id, name: rule.rewardProduct.name, sku: '', barcode: null } : null,
  );
  const [rewardQuantity, setRewardQuantity] = useState(rule ? String(rule.rewardQuantity) : '1');
  const [active, setActive] = useState(rule?.active ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        productId: countBy === 'product' ? product?.id : null,
        category: countBy === 'category' ? category : null,
        requiredQuantity: Number(required.replace(',', '.')),
        rewardProductId: reward?.id,
        rewardQuantity: Number(rewardQuantity.replace(',', '.')),
        active,
      };
      return rule ? api.patch(`/loyalty-rules/${rule.id}`, body) : api.post('/loyalty-rules', body);
    },
    onSuccess: () => {
      toast.success(rule ? 'Cartão alterado' : 'Cartão criado');
      queryClient.invalidateQueries({ queryKey: ['loyalty-rules'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const valid =
    name.trim().length >= 3 &&
    Number(required.replace(',', '.')) > 0 &&
    Boolean(reward) &&
    (countBy === 'product' ? Boolean(product) : Boolean(category));

  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? 'Editar cartão fidelidade' : 'Novo cartão fidelidade'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}
        <Field label="Nome do cartão" required hint='Aparece no caixa, ex.: "Ração: 10 + 1 petisco".'>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <Field label="Contam as compras de">
          {(id) => (
            <Select id={id} value={countBy} onChange={(e) => setCountBy(e.target.value as typeof countBy)}>
              <option value="category">Uma categoria (qualquer produto dela)</option>
              <option value="product">Um produto específico</option>
            </Select>
          )}
        </Field>
        {countBy === 'category' ? (
          <Field label="Categoria" required>
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Escolha</option>
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Produto" required>
            {(id) => <ProductPicker id={id} value={product} onChange={setProduct} />}
          </Field>
        )}
        <Field label="A cada quantos?" required hint="Quantidade comprada para ganhar o brinde (ex.: 10).">
          {(id) => <Input id={id} value={required} onChange={(e) => setRequired(e.target.value)} inputMode="decimal" />}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Brinde" required>
              {(id) => <ProductPicker id={id} value={reward} onChange={setReward} />}
            </Field>
          </div>
          <Field label="Quantidade">
            {(id) => (
              <Input
                id={id}
                value={rewardQuantity}
                onChange={(e) => setRewardQuantity(e.target.value)}
                inputMode="decimal"
              />
            )}
          </Field>
        </div>
        {rule && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 accent-brand-700"
            />
            Cartão ativo
          </label>
        )}
        <p className="text-xs text-slate-500">
          Contam as compras feitas a partir de hoje, com o cliente escolhido na venda. Devoluções e vendas canceladas
          não contam.
        </p>
      </div>
    </Modal>
  );
}
