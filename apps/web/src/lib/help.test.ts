import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, articlesForRoute, searchHelp } from './help';

// Perguntas escritas como um atendente escreveria, e a resposta que precisa vir em primeiro lugar.
const QUESTIONS: Array<[string, string]> = [
  ['como faço pra vender', 'fazer-venda'],
  ['o cliente pagou com nota de 100', 'fazer-venda'],
  ['como abro o caixa de manha', 'abrir-caixa'],
  ['quanto tenho que tirar da gaveta no fim do dia', 'fechar-caixa'],
  ['o caixa não bateu, faltou dinheiro', 'caixa-nao-bateu'],
  ['retirei dinheiro do caixa pra pagar o motoboy', 'sangria'],
  ['troco fixo de 250', 'troco-fixo'],
  ['cliente quer trocar um produto', 'devolucao'],
  ['cancelei errado uma venda', 'cancelar-venda'],
  ['esqueci minha senha', 'esqueci-senha'],
  ['nao consigo entrar no sistema', 'esqueci-senha'],
  ['a impressora nao imprime', 'impressora'],
  ['etiqueta da balança não funciona', 'balanca'],
  ['abri um saco de racao', 'abrir-granel'],
  ['importar xml da nota', 'nfe'],
  ['tenho uma planilha do excel com os produtos', 'importar-planilha'],
  ['pagar metade no pix e metade no cartao', 'duas-formas'],
  ['diz que nao tem estoque e nao deixa vender', 'estoque-zerado'],
  ['estoque ta errado', 'ajuste'],
  ['fazer balanço do estoque', 'inventario'],
  ['como passo produto do deposito pra loja', 'transferencia'],
  ['o que comprar essa semana', 'sugestao-compra'],
  ['produtos encalhados', 'parados'],
  ['quanto lucrei no mês', 'relatorio-vendas'],
  ['criar login pro funcionario', 'usuarios'],
  ['quem mudou o preço', 'quem-alterou'],
  ['fazer backup no pendrive', 'backup'],
  ['troquei de computador', 'computador-novo'],
  ['avisar cliente que a ração vai acabar', 'recompra'],
  ['imprimir etiqueta de preço', 'etiquetas'],
  ['vender fiado', 'fiado'],
  ['o cliente pediu pra entregar em casa', 'entrega'],
  ['vai pagar na entrega, troco pra 50', 'entrega-cobrar'],
  ['o motoboy voltou, cliente nao estava', 'entrega-nao-entregue'],
  ['quanto pagar pro motoboy na semana', 'acerto-entregador'],
  ['mudar a taxa de entrega', 'taxa-entrega'],
  ['avisar o cliente que o pedido saiu', 'painel-entregas'],
  ['quero pendurar na conta do cliente', 'fiado'],
  ['o cliente veio pagar o que devia', 'receber-fiado'],
  ['quem está me devendo', 'quem-deve'],
  ['colocar limite de fiado', 'limite-fiado'],
  ['como mando o pedido pro fornecedor', 'pedido-fornecedor'],
  ['o pedido chegou', 'pedido-chegou'],
  ['botão rápido da ração', 'botoes-rapidos'],
  ['passar os fiados do caderno', 'fiado-caderno'],
  ['lancei o pagamento errado', 'estornar-fiado'],
  ['como faço o cartão fidelidade', 'cartao-fidelidade'],
  ['colocar a ração em promoção', 'promocao'],
  ['leve 3 pague 2', 'promocao'],
  ['montar um kit com ração e petisco', 'kit'],
  ['onde lanço o boleto do aluguel', 'contas-pagar'],
  ['paguei a conta com dinheiro do caixa', 'pagar-conta'],
  ['resumo do mês para o contador', 'fechamento-mes'],
  ['o leitor de codigo de barras nao acha o produto', 'produto-nao-encontrado'],
  ['nao consigo entrar no sistema', 'esqueci-senha'],
];

describe('Central de ajuda', () => {
  it.each(QUESTIONS)('"%s" → %s', (question, expected) => {
    expect(searchHelp(question)[0]?.article.id).toBe(expected);
  });

  it('não inventa resposta para assunto que não é do sistema', () => {
    expect(searchHelp('qual a previsão do tempo')).toEqual([]);
    expect(searchHelp('oi')).toEqual([]);
  });

  it('ids únicos e toda pergunta com resposta e palavras-chave', () => {
    expect(new Set(HELP_ARTICLES.map((article) => article.id)).size).toBe(HELP_ARTICLES.length);
    for (const article of HELP_ARTICLES) {
      expect(article.answer.length).toBeGreaterThan(0);
      expect(article.keywords.length).toBeGreaterThan(0);
    }
  });

  it('mostra as dúvidas da tela atual, inclusive em telas de detalhe', () => {
    expect(articlesForRoute('/cash').map((article) => article.id)).toContain('fechar-caixa');
    expect(articlesForRoute('/products/abc123').map((article) => article.id)).toContain('cadastrar-produto');
  });
});
