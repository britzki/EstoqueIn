import { Input } from './ui';

export interface AddressDraft {
  label: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  reference: string;
}

export const emptyAddress: AddressDraft = {
  label: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  reference: '',
};

export const addressReady = (a: AddressDraft) =>
  a.street.trim().length >= 2 && a.number.trim().length >= 1 && a.district.trim().length >= 2;

/** Campos do endereço de entrega (compacto, para caber na tela de venda e no cadastro do cliente). */
export function AddressForm({
  value,
  onChange,
  withLabel = false,
}: {
  value: AddressDraft;
  onChange: (value: AddressDraft) => void;
  withLabel?: boolean;
}) {
  const set = (field: keyof AddressDraft) => (e: { target: { value: string } }) =>
    onChange({ ...value, [field]: e.target.value });
  return (
    <div className="grid grid-cols-4 gap-2">
      {withLabel && (
        <Input
          value={value.label}
          onChange={set('label')}
          placeholder="Nome (ex.: Casa, Trabalho)"
          aria-label="Nome do endereço"
          className="col-span-4"
        />
      )}
      <Input value={value.street} onChange={set('street')} placeholder="Rua" aria-label="Rua" className="col-span-3" />
      <Input value={value.number} onChange={set('number')} placeholder="Nº" aria-label="Número" />
      <Input
        value={value.complement}
        onChange={set('complement')}
        placeholder="Complemento"
        aria-label="Complemento"
        className="col-span-2"
      />
      <Input
        value={value.district}
        onChange={set('district')}
        placeholder="Bairro"
        aria-label="Bairro"
        className="col-span-2"
      />
      <Input
        value={value.reference}
        onChange={set('reference')}
        placeholder="Ponto de referência (ajuda o entregador)"
        aria-label="Ponto de referência"
        className="col-span-4"
      />
    </div>
  );
}
