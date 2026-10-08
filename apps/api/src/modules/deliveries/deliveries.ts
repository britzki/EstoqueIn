import { z } from 'zod';
import type { Tx } from '../../lib/prisma.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { id, optionalText } from '../../lib/validation.js';

/** Endereço de entrega (novo ou do cadastro do cliente). */
export const addressSchema = z.object({
  label: optionalText(30),
  street: z.string().trim().min(2, 'Informe a rua').max(120),
  number: z.string().trim().min(1, 'Informe o número').max(20),
  complement: optionalText(60),
  district: z.string().trim().min(2, 'Informe o bairro').max(60),
  reference: optionalText(120),
});

/** O que vem junto da venda quando ela é para entregar. */
export const saleDeliverySchema = z
  .object({
    /** Endereço já cadastrado do cliente... */
    addressId: id.optional(),
    /** ...ou um endereço novo, que fica salvo no cadastro. */
    address: addressSchema.optional(),
    /** Cobrar na entrega (dinheiro com troco ou cartão na maquininha). Falso = já pago (ex.: Pix antes). */
    collectOnDelivery: z.boolean().default(false),
    /** Entrega agendada; sem isso, o prazo é agora + o prazo padrão da loja. */
    scheduledFor: z.coerce.date().optional(),
    /** Não cobrar a taxa nesta venda. */
    waiveFee: z.boolean().default(false),
    notes: optionalText(200),
  })
  .refine((value) => value.addressId || value.address, { message: 'Escolha ou informe o endereço de entrega' });

export type SaleDeliveryInput = z.infer<typeof saleDeliverySchema>;

/** Taxa de entrega pela regra da loja: cobra abaixo do valor mínimo; acima dele, grátis. */
export const deliveryFee = (
  itemsCents: number,
  settings: { deliveryFeeCents: number; deliveryFreeAboveCents: number },
  waive = false,
) => (waive || itemsCents >= settings.deliveryFreeAboveCents ? 0 : settings.deliveryFeeCents);

/**
 * Cria a entrega dentro da transação da venda. O endereço é copiado para a entrega:
 * mudar o cadastro depois não muda o que foi impresso para o entregador.
 */
export async function createDelivery(
  tx: Tx,
  input: SaleDeliveryInput,
  ctx: {
    saleId: string;
    customer: { id: string; phone: string | null };
    feeCents: number;
    deadlineMinutes: number;
    userId: string;
  },
) {
  let address;
  if (input.addressId) {
    address = await tx.customerAddress.findUnique({ where: { id: input.addressId } });
    if (!address || address.customerId !== ctx.customer.id) throw notFound('Endereço do cliente');
  } else {
    address = await tx.customerAddress.create({ data: { ...input.address!, customerId: ctx.customer.id } });
  }
  if (input.scheduledFor && input.scheduledFor.getTime() < Date.now() - 5 * 60_000) {
    throw unprocessable('O horário agendado já passou');
  }

  const last = await tx.delivery.aggregate({ _max: { number: true } });
  return tx.delivery.create({
    data: {
      number: (last._max.number ?? 0) + 1,
      saleId: ctx.saleId,
      customerId: ctx.customer.id,
      street: address.street,
      addressNumber: address.number,
      complement: address.complement,
      district: address.district,
      reference: address.reference,
      phone: ctx.customer.phone,
      feeCents: ctx.feeCents,
      collectOnDelivery: input.collectOnDelivery,
      dueAt: input.scheduledFor ?? new Date(Date.now() + ctx.deadlineMinutes * 60_000),
      scheduled: Boolean(input.scheduledFor),
      notes: input.notes ?? null,
      createdById: ctx.userId,
    },
  });
}
