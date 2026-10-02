import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { desktop } from '../lib/desktop';
import { useStoreSettings } from '../lib/hooks';
import { centsToInput, parseMoneyInput } from '../lib/format';
import { useToast } from '../lib/toast';
import type { SaleDetail, StoreSettings } from '../lib/types';
import { Receipt } from '../components/Receipt';
import { ExternalBackupCard } from './settings/ExternalBackupCard';
import {
  Button,
  Card,
  CardHeader,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';

const SAMPLE_SALE: SaleDetail = {
  id: 'exemplo',
  number: 128,
  status: 'COMPLETED',
  customerName: null,
  customerId: null,
  customer: null,
  returns: [],
  subtotalCents: 6627,
  discountCents: 0,
  totalCents: 6627,
  paidCents: 7000,
  changeCents: 373,
  createdAt: new Date().toISOString(),
  cancelledAt: null,
  cancelReason: null,
  cancelledBy: null,
  payments: [{ method: 'CASH', amountCents: 7000 }],
  user: { id: 'u', name: 'Atendente' },
  warehouse: { id: 'w', name: 'Loja' },
  items: [
    {
      id: '1',
      productId: 'a',
      description: 'Coleira M',
      unit: 'UN',
      quantity: 2,
      unitPriceCents: 3000,
      totalCents: 6000,
    },
    {
      id: '2',
      productId: 'b',
      description: 'Ração a granel',
      unit: 'KG',
      quantity: 0.35,
      unitPriceCents: 1790,
      totalCents: 627,
    },
  ],
};

export function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useStoreSettings();
  const [form, setForm] = useState<StoreSettings | null>(null);
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string }>>([]);
  const [printer, setPrinter] = useState('');

  if (settings.data && !form) setForm(settings.data);

  // Só no programa instalado: lista as impressoras do Windows para a impressão direta da notinha.
  useEffect(() => {
    if (!desktop) return;
    desktop
      .listPrinters()
      .then(setPrinters)
      .catch(() => undefined);
    desktop
      .getReceiptPrinter()
      .then((name) => setPrinter(name ?? ''))
      .catch(() => undefined);
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      if (desktop) await desktop.setReceiptPrinter(printer || null);
      return api.put<StoreSettings>('/settings', {
        ...form,
        document: form?.document ?? '',
        address: form?.address ?? '',
        phone: form?.phone ?? '',
        receiptFooter: form?.receiptFooter ?? '',
      });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved);
      setForm(saved);
      toast.success('Configurações salvas');
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  if (!form) return settings.isError ? <ErrorMessage error={settings.error} /> : <Spinner />;

  const set = <K extends keyof StoreSettings>(field: K, value: StoreSettings[K]) =>
    setForm({ ...form, [field]: value });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <>
      <PageHeader
        title="Configurações da loja"
        description="Dados da notinha, impressora, caixa, balança e cópia de segurança."
      />

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {save.error && !Object.keys(errors).length ? <ErrorMessage error={save.error} /> : null}

          <Card>
            <CardHeader title="Dados da loja" description="Aparecem no cabeçalho da notinha." />
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Field label="Nome da loja" required error={errors.storeName?.[0]} className="sm:col-span-2">
                {(id) => (
                  <Input id={id} value={form.storeName} onChange={(e) => set('storeName', e.target.value)} required />
                )}
              </Field>
              <Field label="CNPJ">
                {(id) => (
                  <Input id={id} value={form.document ?? ''} onChange={(e) => set('document', e.target.value)} />
                )}
              </Field>
              <Field label="Telefone / WhatsApp">
                {(id) => <Input id={id} value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />}
              </Field>
              <Field label="Endereço" className="sm:col-span-2">
                {(id) => <Input id={id} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />}
              </Field>
              <Field label="Mensagem no rodapé" className="sm:col-span-2">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={form.receiptFooter ?? ''}
                    onChange={(e) => set('receiptFooter', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Impressão da notinha" />
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Field label="Largura da bobina">
                {(id) => (
                  <Select
                    id={id}
                    value={form.receiptWidth}
                    onChange={(e) => set('receiptWidth', Number(e.target.value) as 58 | 80)}
                  >
                    <option value={80}>80 mm</option>
                    <option value={58}>58 mm</option>
                  </Select>
                )}
              </Field>
              {desktop ? (
                <Field
                  label="Impressora"
                  hint="Com uma impressora escolhida, a notinha sai direto, sem janela de confirmação."
                >
                  {(id) => (
                    <Select id={id} value={printer} onChange={(e) => setPrinter(e.target.value)}>
                      <option value="">Perguntar a cada impressão</option>
                      {printers.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.displayName || item.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <p className="self-end text-sm text-slate-500">
                  No navegador, a impressão abre a janela do sistema. No programa instalado dá para escolher a
                  impressora e imprimir direto.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.autoPrint}
                  onChange={(e) => set('autoPrint', e.target.checked)}
                  className="size-4 accent-brand-700"
                />
                Imprimir a notinha automaticamente ao finalizar a venda
              </label>
            </div>
          </Card>

          <Card>
            <CardHeader title="Vendas e caixa" />
            <div className="space-y-3 p-5">
              <Toggle
                checked={form.requireCashSession}
                onChange={(value) => set('requireCashSession', value)}
                label="Exigir caixa aberto para vender"
                hint="No começo do dia abre-se o caixa com o troco; no fim, confere-se o dinheiro da gaveta."
              />
              <div className="max-w-xs pl-7">
                <Field
                  label="Troco fixo da gaveta (R$)"
                  hint="Valor com que o caixa abre todo dia. No fechamento, o sistema diz quanto retirar para sobrar esse valor."
                >
                  {(id) => (
                    <Input
                      id={id}
                      defaultValue={form.cashFloatCents ? centsToInput(form.cashFloatCents) : ''}
                      onChange={(e) => set('cashFloatCents', parseMoneyInput(e.target.value) ?? 0)}
                      inputMode="decimal"
                      placeholder="0,00"
                    />
                  )}
                </Field>
              </div>
              <Toggle
                checked={form.allowNegativeStock}
                onChange={(value) => set('allowNegativeStock', value)}
                label="Permitir vender produto com estoque zerado"
                hint="O cliente não fica sem atendimento se o estoque do sistema estiver errado. O saldo fica negativo e aparece um alerta para conferir."
              />
            </div>
          </Card>

          {desktop ? <ExternalBackupCard /> : null}

          <Card>
            <CardHeader
              title="Balança etiquetadora"
              description="Como o sistema lê o código de barras da etiqueta. Confira no manual ou na configuração da balança."
            />
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
              <Field
                label="A etiqueta traz"
                hint="Recomendado: peso. O sistema calcula o valor e baixa os quilos certos."
              >
                {(id) => (
                  <Select
                    id={id}
                    value={form.scaleValueType}
                    onChange={(e) => set('scaleValueType', e.target.value as 'WEIGHT' | 'PRICE')}
                  >
                    <option value="WEIGHT">Peso (gramas)</option>
                    <option value="PRICE">Preço total</option>
                  </Select>
                )}
              </Field>
              <Field label="Dígito inicial" error={errors.scalePrefix?.[0]} hint="Normalmente 2.">
                {(id) => (
                  <Input id={id} value={form.scalePrefix} onChange={(e) => set('scalePrefix', e.target.value)} />
                )}
              </Field>
              <Field label="Dígitos do código do produto" hint="Normalmente 4, 5 ou 6.">
                {(id) => (
                  <Select
                    id={id}
                    value={form.scaleCodeDigits}
                    onChange={(e) => set('scaleCodeDigits', Number(e.target.value))}
                  >
                    {[4, 5, 6].map((digits) => (
                      <option key={digits}>{digits}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 sm:col-span-3">
                Formato lido: {form.scalePrefix} {'C'.repeat(form.scaleCodeDigits)}{' '}
                {'0'.repeat(Math.max(12 - form.scalePrefix.length - form.scaleCodeDigits - 5, 0))}{' '}
                {form.scaleValueType === 'WEIGHT' ? 'PPPPP' : 'VVVVV'} D · C = código do produto na balança,{' '}
                {form.scaleValueType === 'WEIGHT' ? 'P = peso em gramas' : 'V = valor em centavos'}, D = verificador
              </p>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending}>
              Salvar configurações
            </Button>
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader title="Prévia da notinha" />
          <div className="flex justify-center overflow-x-auto bg-slate-100 p-5">
            <div className="shadow-md">
              <Receipt sale={SAMPLE_SALE} settings={form} />
            </div>
          </div>
        </Card>
      </form>
    </>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-brand-700"
      />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        <span className="block text-slate-500">{hint}</span>
      </span>
    </label>
  );
}
