/**
 * Central de ajuda: perguntas frequentes e a busca usada pelo assistente.
 * Tudo fica dentro do programa e funciona sem internet. Ao mudar uma tela, revise as respostas dela aqui.
 *
 * Formato das respostas: cada item do array é um parágrafo; itens que começam com "1.", "2."... viram passos.
 */

export type HelpCategory =
  | 'Primeiros passos'
  | 'Vendas'
  | 'Caixa'
  | 'Estoque'
  | 'Produtos e cadastros'
  | 'Clientes'
  | 'Relatórios'
  | 'Usuários e senhas'
  | 'Backup e problemas';

export interface HelpArticle {
  id: string;
  category: HelpCategory;
  question: string;
  answer: string[];
  /** Palavras que a pessoa pode usar ao perguntar, além das que já estão na pergunta. */
  keywords: string[];
  /** Telas onde a pergunta aparece em "Dúvidas desta tela". */
  routes?: string[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  'Primeiros passos',
  'Vendas',
  'Caixa',
  'Estoque',
  'Produtos e cadastros',
  'Clientes',
  'Relatórios',
  'Usuários e senhas',
  'Backup e problemas',
];

export const HELP_ARTICLES: HelpArticle[] = [
  /* ---------- Primeiros passos ---------- */
  {
    id: 'primeiros-passos',
    category: 'Primeiros passos',
    question: 'Por onde eu começo a usar o sistema?',
    answer: [
      '1. Em Configurações, preencha os dados da loja (saem na notinha), escolha a impressora e, se usar, o troco fixo do caixa.',
      '2. Em Usuários, crie um acesso para cada funcionário.',
      '3. Cadastre os produtos: um por um em Produtos → Novo produto, por planilha em Produtos → Importar CSV, ou pela nota do fornecedor em Entrada por NF-e.',
      '4. Abra o caixa e faça a primeira venda em Nova venda.',
    ],
    keywords: ['comecar', 'inicio', 'configurar', 'instalar', 'primeira vez', 'novo', 'tutorial'],
    routes: ['/'],
  },
  {
    id: 'dashboard',
    category: 'Primeiros passos',
    question: 'O que mostra a tela inicial (Dashboard)?',
    answer: [
      'Um resumo da loja: vendas de hoje, produtos ativos, valor em estoque, alertas abertos, o gráfico de entradas e saídas e as últimas movimentações.',
      'Os números se atualizam sozinhos a cada venda ou movimentação.',
    ],
    keywords: ['inicio', 'painel', 'resumo', 'tela inicial', 'grafico'],
    routes: ['/'],
  },
  {
    id: 'atalhos',
    category: 'Primeiros passos',
    question: 'Quais são os atalhos de teclado?',
    answer: [
      'Na tela de venda: F2 finaliza a venda e F4 volta o cursor para o campo de leitura do código.',
      'O leitor de código de barras funciona como um teclado: basta bipar com o cursor no campo de produto.',
      'Ctrl+B faz um backup na hora (no programa instalado).',
    ],
    keywords: ['teclado', 'f2', 'f4', 'atalho', 'tecla', 'rapido'],
    routes: ['/sales/new'],
  },
  {
    id: 'celular',
    category: 'Primeiros passos',
    question: 'Consigo usar pelo celular ou em outro computador?',
    answer: [
      'Ainda não. Hoje o EstoqueIn funciona no computador onde foi instalado, com os dados guardados nele, e não depende de internet.',
      'O acesso pelo celular está nos planos. Se precisar dele, fale com o suporte.',
    ],
    keywords: ['celular', 'telefone', 'mobile', 'outro computador', 'internet', 'online', 'nuvem', 'casa'],
  },
  {
    id: 'internet',
    category: 'Primeiros passos',
    question: 'Preciso de internet para usar?',
    answer: [
      'Não. Vendas, estoque, relatórios e backup funcionam sem internet.',
      'A internet só é usada para abrir o WhatsApp (lembrete de recompra e suporte) e, se você escolher, para enviar a cópia de segurança a uma pasta do Google Drive ou OneDrive.',
    ],
    keywords: ['internet', 'offline', 'sem internet', 'conexao', 'wifi', 'caiu'],
  },

  /* ---------- Vendas ---------- */
  {
    id: 'fazer-venda',
    category: 'Vendas',
    question: 'Como faço uma venda?',
    answer: [
      '1. Abra Nova venda (o caixa precisa estar aberto).',
      '2. Bipe o código de barras, a etiqueta da balança ou digite o nome do produto e escolha na lista.',
      '3. Para mudar a quantidade, edite o número ao lado do produto.',
      '4. Escolha a forma de pagamento. Em dinheiro, informe o valor recebido para ver o troco.',
      '5. Clique em Finalizar venda ou aperte F2. A notinha sai na impressora.',
    ],
    keywords: [
      'vender',
      'venda',
      'pdv',
      'registrar venda',
      'finalizar',
      'cobrar',
      'balcao',
      'troco',
      'nota de',
      'pagou em dinheiro',
      'valor recebido',
    ],
    routes: ['/sales/new'],
  },
  {
    id: 'desconto',
    category: 'Vendas',
    question: 'Como dou desconto?',
    answer: [
      'Na tela de venda, preencha o campo Desconto (R$) com o valor em reais. O total é recalculado na hora.',
      'O desconto vale para a venda inteira e aparece na notinha.',
    ],
    keywords: ['desconto', 'abatimento', 'promocao', 'baixar preco', 'reduzir'],
    routes: ['/sales/new'],
  },
  {
    id: 'duas-formas',
    category: 'Vendas',
    question: 'O cliente quer pagar parte no Pix e parte no cartão. Como faço?',
    answer: [
      'Marque "Dividir em duas formas de pagamento". Escolha a primeira forma, informe o valor pago nela e escolha a forma do restante.',
    ],
    keywords: ['dividir', 'duas formas', 'parte', 'metade', 'pix e cartao', 'misto', 'pagamento'],
    routes: ['/sales/new'],
  },
  {
    id: 'balanca',
    category: 'Vendas',
    question: 'Como vendo ração a granel com a etiqueta da balança?',
    answer: [
      'Pese na balança etiquetadora e bipe a etiqueta na tela de venda: o produto e o peso entram sozinhos.',
      'Para isso, o produto precisa ter o "Código na balança" igual ao código cadastrado na balança.',
      'Se a etiqueta não for reconhecida, confira em Configurações → Balança etiquetadora se o formato (peso ou preço, dígito inicial e quantidade de dígitos) é o mesmo da balança.',
      'Sem etiqueta, digite o nome do produto, escolha na lista e informe o peso no campo de quantidade (ex.: 0,350 para 350 g).',
    ],
    keywords: ['balanca', 'etiqueta', 'granel', 'peso', 'quilo', 'kg', 'gramas', 'pesar', 'racao'],
    routes: ['/sales/new', '/settings'],
  },
  {
    id: 'produto-nao-encontrado',
    category: 'Vendas',
    question: 'Bipei o produto e apareceu "não encontrado". O que faço?',
    answer: [
      'O código de barras ainda não está no cadastro. Procure o produto pelo nome no mesmo campo e venda normalmente.',
      'Depois, quem tem acesso a Produtos pode abrir o cadastro do produto e preencher o código de barras, para da próxima vez ele ser reconhecido.',
    ],
    keywords: [
      'nao encontrado',
      'nao acha',
      'nao acha o produto',
      'nao achou',
      'codigo',
      'bipar',
      'leitor',
      'nao reconhece',
      'erro',
    ],
    routes: ['/sales/new'],
  },
  {
    id: 'estoque-zerado',
    category: 'Vendas',
    question: 'O sistema não deixa vender porque diz que não tem estoque. E agora?',
    answer: [
      'O sistema protege o estoque: não vende mais do que está registrado. Se o produto está na prateleira, o estoque do sistema está errado.',
      'Corrija com uma entrada (se a mercadoria chegou e não foi lançada) ou com um ajuste em Nova movimentação → Ajuste.',
      'Se preferir não travar o balcão, o gerente pode ligar em Configurações → "Permitir vender produto com estoque zerado". A venda passa, o saldo fica negativo e aparece um alerta para conferir.',
    ],
    keywords: ['sem estoque', 'estoque insuficiente', 'zerado', 'negativo', 'nao deixa vender', 'disponivel'],
    routes: ['/sales/new', '/alerts'],
  },
  {
    id: 'botoes-rapidos',
    category: 'Vendas',
    question: 'Como funcionam os botões rápidos da tela de venda?',
    answer: [
      'Logo abaixo do campo de leitura aparecem até 8 produtos: um clique coloca o produto na venda, sem bipar nem buscar. Produto por peso pede a quantidade.',
      'Os marcados com estrela são os escolhidos por você: no cadastro do produto, marque "Botão rápido na tela de venda". O espaço que sobrar é preenchido com os mais vendidos dos últimos 30 dias.',
    ],
    keywords: ['botao rapido', 'botoes', 'atalho de produto', 'favorito', 'estrela', 'mais vendidos', 'clique'],
    routes: ['/sales/new', '/products'],
  },
  {
    id: 'cliente-na-venda',
    category: 'Vendas',
    question: 'Como coloco o cliente na venda?',
    answer: [
      'No campo Cliente, digite o nome ou o telefone e escolha na lista. Se for cliente novo, clique em Cadastrar e informe o WhatsApp.',
      'Com o cliente escolhido, a compra entra no histórico dele e no lembrete de recompra.',
    ],
    keywords: ['cliente', 'nome do cliente', 'cadastrar cliente', 'whatsapp', 'telefone'],
    routes: ['/sales/new', '/customers'],
  },
  {
    id: 'cancelar-venda',
    category: 'Vendas',
    question: 'Como cancelo uma venda?',
    answer: [
      '1. Vá em Vendas e clique na venda.',
      '2. Clique em Cancelar venda e escreva o motivo.',
      'Os itens voltam ao estoque e a venda continua no histórico, marcada como cancelada. Só gerente ou administrador pode cancelar.',
      'Se o cliente devolveu só parte da compra, use Devolver itens em vez de cancelar.',
    ],
    keywords: ['cancelar', 'cancelamento', 'estornar', 'desfazer', 'errei', 'apagar venda', 'excluir venda'],
    routes: ['/sales'],
  },
  {
    id: 'devolucao',
    category: 'Vendas',
    question: 'O cliente devolveu um produto. Como registro?',
    answer: [
      '1. Vá em Vendas e clique na venda.',
      '2. Clique em Devolver itens.',
      '3. Informe quanto de cada item voltou, a forma de devolução do dinheiro e o motivo.',
      'Os itens voltam ao estoque. Se a venda teve desconto, o valor devolvido é proporcional ao que o cliente pagou. Devolução em dinheiro sai do caixa aberto.',
      'Para trocar por outro produto: registre a devolução e faça uma venda nova.',
    ],
    keywords: ['devolucao', 'devolver', 'troca', 'trocar', 'estorno', 'reembolso', 'defeito', 'voltou'],
    routes: ['/sales'],
  },
  {
    id: 'reimprimir',
    category: 'Vendas',
    question: 'Como imprimo a notinha de novo?',
    answer: ['Vá em Vendas, clique na venda e em Imprimir notinha.'],
    keywords: ['reimprimir', 'segunda via', 'notinha', 'comprovante', 'cupom', 'imprimir'],
    routes: ['/sales'],
  },
  {
    id: 'impressora',
    category: 'Vendas',
    question: 'A notinha não sai na impressora. O que verifico?',
    answer: [
      '1. A impressora está ligada, com papel e aparece no Windows (Configurações do Windows → Impressoras)?',
      '2. Em Configurações → Impressão da notinha, a impressora certa está escolhida e a largura da bobina (58 ou 80 mm) confere?',
      '3. "Imprimir a notinha automaticamente" está marcado? Se não estiver, use o botão Imprimir notinha depois da venda.',
      'Se continuar, gere o arquivo de diagnóstico e fale com o suporte.',
    ],
    keywords: ['impressora', 'nao imprime', 'notinha', 'bobina', 'termica', 'papel', 'imprimir'],
    routes: ['/settings', '/sales/new'],
  },
  {
    id: 'nota-fiscal',
    category: 'Vendas',
    question: 'A notinha vale como nota fiscal?',
    answer: [
      'Não. A notinha é um comprovante de controle interno e traz escrito "Não é documento fiscal".',
      'A nota fiscal ao consumidor continua sendo emitida pelo sistema que a loja já usa para isso.',
    ],
    keywords: ['nota fiscal', 'nfce', 'nfc-e', 'cupom fiscal', 'sat', 'fiscal', 'imposto'],
  },

  /* ---------- Caixa ---------- */
  {
    id: 'abrir-caixa',
    category: 'Caixa',
    question: 'Como abro o caixa?',
    answer: [
      'Em Caixa (ou direto na tela de venda, quando aparecer "O caixa está fechado"), confira o dinheiro da gaveta, informe o troco inicial e clique em Abrir caixa.',
      'O valor já vem preenchido com o que ficou na gaveta no último fechamento. Se for diferente, o sistema avisa.',
    ],
    keywords: ['abrir caixa', 'abertura', 'troco inicial', 'comecar o dia', 'caixa fechado', 'gaveta'],
    routes: ['/cash', '/sales/new'],
  },
  {
    id: 'fechar-caixa',
    category: 'Caixa',
    question: 'Como fecho o caixa no fim do dia?',
    answer: [
      '1. Em Caixa, clique em Fechar caixa.',
      '2. Conte só o dinheiro em espécie da gaveta (Pix e cartão não entram) e informe o total.',
      '3. O sistema mostra se bateu, faltou ou sobrou, quanto retirar da gaveta e quanto deixar para o troco de amanhã.',
      '4. Clique em Fechar caixa e imprima o comprovante para guardar junto com o dinheiro retirado.',
    ],
    keywords: ['fechar caixa', 'fechamento', 'fim do dia', 'conferir', 'contar dinheiro', 'retirar', 'lucro', 'gaveta'],
    routes: ['/cash'],
  },
  {
    id: 'troco-fixo',
    category: 'Caixa',
    question: 'O caixa sempre começa com o mesmo valor de troco. Dá para configurar?',
    answer: [
      'Sim. Em Configurações → Vendas e caixa, preencha o Troco fixo da gaveta (ex.: R$ 250,00).',
      'No fechamento, o sistema calcula quanto retirar para sobrar exatamente esse valor, e a abertura seguinte já vem preenchida com ele.',
    ],
    keywords: ['troco fixo', 'fundo de troco', '250', 'mesmo valor', 'troco', 'gaveta'],
    routes: ['/cash', '/settings'],
  },
  {
    id: 'sangria',
    category: 'Caixa',
    question: 'O que é sangria e suprimento?',
    answer: [
      'Sangria é dinheiro tirado da gaveta durante o dia (pagar um fornecedor, depositar no banco). Suprimento é dinheiro colocado na gaveta (reforço de troco).',
      'Registre os dois em Caixa, com o motivo, para o fechamento bater.',
    ],
    keywords: [
      'sangria',
      'suprimento',
      'retirada',
      'tirar dinheiro',
      'colocar dinheiro',
      'tirei dinheiro',
      'retirei dinheiro',
      'reforco',
      'pagar fornecedor',
      'motoboy',
      'paguei',
      'despesa',
      'deposito no banco',
    ],
    routes: ['/cash'],
  },
  {
    id: 'caixa-nao-bateu',
    category: 'Caixa',
    question: 'O caixa não bateu. O que pode ter acontecido?',
    answer: [
      'As causas mais comuns:',
      '1. Troco dado errado.',
      '2. Dinheiro tirado da gaveta sem registrar a sangria.',
      '3. Venda paga no Pix ou cartão lançada como dinheiro (ou o contrário).',
      '4. Devolução em dinheiro feita sem registrar.',
      'Confira as vendas do dia em Vendas e as formas de pagamento no resumo do caixa. A diferença fica registrada no fechamento, com a observação que você escrever.',
    ],
    keywords: ['nao bateu', 'diferenca', 'faltou', 'sobrou', 'falta dinheiro', 'sobra', 'conferencia'],
    routes: ['/cash'],
  },
  {
    id: 'vender-sem-caixa',
    category: 'Caixa',
    question: 'Dá para vender sem abrir o caixa?',
    answer: [
      'Sim, se o gerente desligar "Exigir caixa aberto para vender" em Configurações. Nesse caso não há fechamento nem conferência da gaveta.',
    ],
    keywords: ['sem caixa', 'nao quero caixa', 'desligar caixa', 'exigir caixa'],
    routes: ['/settings'],
  },

  /* ---------- Estoque ---------- */
  {
    id: 'entrada',
    category: 'Estoque',
    question: 'Chegou mercadoria. Como dou entrada?',
    answer: [
      'Com o XML da nota do fornecedor, use Entrada por NF-e: o sistema lê a nota, reconhece os produtos e dá entrada em tudo de uma vez, com o custo certo.',
      'Sem o XML: Nova movimentação → Entrada. Escolha o produto, a quantidade, o custo unitário e, se quiser, o número da nota.',
    ],
    keywords: ['entrada', 'chegou', 'mercadoria', 'compra', 'recebi', 'repor', 'abastecer'],
    routes: ['/movements/new', '/movements/nfe'],
  },
  {
    id: 'nfe',
    category: 'Estoque',
    question: 'Como funciona a entrada pela nota fiscal (XML)?',
    answer: [
      '1. Em Entrada por NF-e, arraste o arquivo XML que o fornecedor envia por e-mail.',
      '2. Confira cada item: o sistema mostra se reconheceu o produto, se é um produto novo ou se precisa escolher.',
      '3. Em embalagens (caixa com 12, fardo com 6), confira a conversão para unidades.',
      '4. Clique em Confirmar entrada.',
      'Na próxima nota do mesmo fornecedor, os produtos já chegam reconhecidos. A mesma nota não pode ser importada duas vezes.',
    ],
    keywords: ['nfe', 'nf-e', 'xml', 'nota', 'nota fiscal', 'fornecedor', 'importar nota'],
    routes: ['/movements/nfe'],
  },
  {
    id: 'saida',
    category: 'Estoque',
    question: 'Como registro uma perda, quebra ou uso interno?',
    answer: [
      'Nova movimentação → Saída. Escolha o produto, a quantidade e escreva o motivo (ex.: "embalagem rasgada", "uso na loja").',
      'Vendas não precisam disso: a baixa é feita sozinha ao vender.',
    ],
    keywords: ['saida', 'perda', 'quebra', 'vencido', 'uso interno', 'avaria', 'dar baixa', 'jogar fora'],
    routes: ['/movements/new'],
  },
  {
    id: 'ajuste',
    category: 'Estoque',
    question: 'O estoque do sistema está diferente da prateleira. Como corrijo?',
    answer: [
      'Para um produto: Nova movimentação → Ajuste, informe a quantidade real e o motivo (só gerente ou administrador).',
      'Para vários produtos: faça um Inventário. Ele compara a contagem com o sistema e ajusta tudo ao concluir.',
      'O histórico nunca é apagado: o ajuste fica registrado com quem fez e por quê.',
    ],
    keywords: ['ajuste', 'corrigir', 'diferente', 'errado', 'acertar estoque', 'saldo errado', 'contagem'],
    routes: ['/movements/new', '/inventories'],
  },
  {
    id: 'inventario',
    category: 'Estoque',
    question: 'Como faço o inventário (contagem do estoque)?',
    answer: [
      '1. Em Inventário, clique em Novo inventário e escolha o estoque (e, se quiser, uma categoria).',
      '2. Conte os produtos. Dá para bipar com o leitor: cada leitura soma 1, ou digite a quantidade.',
      '3. Ao terminar, confira as divergências e clique em Concluir e ajustar saldos.',
      'Vendas feitas durante a contagem não atrapalham: o ajuste considera o que foi vendido no meio do caminho.',
    ],
    keywords: ['inventario', 'contagem', 'contar estoque', 'balanco', 'conferir estoque'],
    routes: ['/inventories'],
  },
  {
    id: 'transferencia',
    category: 'Estoque',
    question: 'Como passo produtos de um estoque para outro?',
    answer: [
      'Nova movimentação → Transferência. Escolha o produto, o estoque de origem, o de destino e a quantidade. A saída e a entrada são registradas juntas.',
    ],
    keywords: ['transferir', 'transferencia', 'mover', 'deposito', 'outra loja', 'passar'],
    routes: ['/movements/new', '/warehouses'],
  },
  {
    id: 'abrir-granel',
    category: 'Estoque',
    question: 'Abri um saco de ração para vender a granel. O que faço no sistema?',
    answer: [
      'Nova movimentação → Abrir para granel (ou o botão Abrir para granel no cadastro do produto). Informe quantos sacos foram abertos.',
      'O saco sai do estoque e os quilos entram no produto a granel, com o custo proporcional.',
      'Se o produto a granel ainda não existe, abra o cadastro do saco fechado e use Criar versão a granel.',
    ],
    keywords: ['granel', 'abrir saco', 'abrir pacote', 'fracionar', 'racao', 'saco', 'quilo', 'kg'],
    routes: ['/movements/new', '/products'],
  },
  {
    id: 'alertas',
    category: 'Estoque',
    question: 'O que significam os alertas?',
    answer: [
      'Estoque baixo: o produto chegou ao estoque mínimo. Sem estoque: zerou. Estoque negativo: foi vendido além do registrado e o estoque precisa ser conferido.',
      'O botão Repor leva à entrada do produto. O alerta some sozinho quando o estoque volta a ficar acima do mínimo. Ciente só indica que alguém já viu.',
    ],
    keywords: ['alerta', 'aviso', 'estoque baixo', 'minimo', 'acabando', 'vermelho', 'notificacao', 'ciente'],
    routes: ['/alerts', '/'],
  },
  {
    id: 'minimo',
    category: 'Estoque',
    question: 'Como defino o estoque mínimo de um produto?',
    answer: [
      'No cadastro do produto, preencha Estoque mínimo. Quando o saldo chegar nesse valor, aparece um alerta.',
      'Se tiver mais de um estoque, dá para definir um mínimo diferente para cada um na página do produto.',
    ],
    keywords: ['minimo', 'estoque minimo', 'alerta', 'quando comprar', 'limite'],
    routes: ['/products'],
  },
  {
    id: 'historico',
    category: 'Estoque',
    question: 'Onde vejo tudo o que entrou e saiu de um produto?',
    answer: [
      'Na página do próprio produto (Produtos → clique no produto), ou em Histórico, com filtros por tipo, estoque e período. Dá para exportar para o Excel.',
    ],
    keywords: ['historico', 'movimentacoes', 'extrato', 'entrou', 'saiu', 'quem mexeu', 'rastrear'],
    routes: ['/movements'],
  },

  /* ---------- Produtos e cadastros ---------- */
  {
    id: 'cadastrar-produto',
    category: 'Produtos e cadastros',
    question: 'Como cadastro um produto?',
    answer: [
      'Produtos → Novo produto. Preencha código (SKU), nome, unidade, preço de venda e estoque mínimo. O código de barras pode ser bipado direto no campo.',
      'Produto vendido por peso: use a unidade KG e, se usar balança etiquetadora, preencha o Código na balança.',
      'O estoque inicial entra por uma Entrada (ou pela importação de planilha com a coluna saldo).',
    ],
    keywords: ['cadastrar', 'novo produto', 'cadastro', 'incluir produto', 'adicionar produto', 'sku'],
    routes: ['/products'],
  },
  {
    id: 'importar-planilha',
    category: 'Produtos e cadastros',
    question: 'Tenho os produtos numa planilha. Dá para importar?',
    answer: [
      '1. Produtos → Importar CSV. Clique em Baixar modelo para ver as colunas.',
      '2. No Excel, salve a planilha como CSV.',
      '3. Envie o arquivo: a pré-visualização mostra o que será criado, atualizado e as linhas com erro, sem gravar nada.',
      '4. Confirme. Com a coluna saldo, o estoque atual de cada produto já entra junto.',
    ],
    keywords: ['planilha', 'excel', 'csv', 'importar', 'migrar', 'sistema antigo', 'lista de produtos'],
    routes: ['/products', '/products/import'],
  },
  {
    id: 'preco',
    category: 'Produtos e cadastros',
    question: 'Como mudo o preço de um produto?',
    answer: [
      'Produtos → clique no produto → Editar → altere o Preço de venda e salve. A mudança vale para as próximas vendas e fica no registro de alterações.',
      'Só gerente ou administrador altera preços.',
    ],
    keywords: ['preco', 'alterar preco', 'mudar preco', 'reajuste', 'valor de venda', 'aumentar'],
    routes: ['/products'],
  },
  {
    id: 'custo',
    category: 'Produtos e cadastros',
    question: 'Como o sistema calcula o custo dos produtos?',
    answer: [
      'Pelo custo médio: a cada entrada, o custo informado é ponderado com o que já havia em estoque. Na entrada por NF-e, frete, IPI e substituição tributária da nota entram no custo.',
      'Esse custo é usado no lucro das vendas e no valor do estoque.',
    ],
    keywords: ['custo', 'custo medio', 'margem', 'lucro', 'preco de custo'],
    routes: ['/products'],
  },
  {
    id: 'etiquetas',
    category: 'Produtos e cadastros',
    question: 'Como imprimo etiquetas de preço com código de barras?',
    answer: [
      'Abra o produto e clique em Etiquetas. Se o produto não tem código de barras, use antes Gerar código para criar um código interno.',
    ],
    keywords: ['etiqueta', 'codigo de barras', 'gondola', 'preco na prateleira', 'imprimir etiqueta', 'gerar codigo'],
    routes: ['/products'],
  },
  {
    id: 'fornecedor',
    category: 'Produtos e cadastros',
    question: 'Como cadastro um fornecedor?',
    answer: [
      'Fornecedores → Novo fornecedor. Fornecedores também são cadastrados sozinhos quando você importa a primeira nota (XML) deles.',
    ],
    keywords: ['fornecedor', 'distribuidor', 'cadastrar fornecedor'],
    routes: ['/suppliers'],
  },

  /* ---------- Clientes ---------- */
  {
    id: 'recompra',
    category: 'Clientes',
    question: 'Como funciona o lembrete de recompra?',
    answer: [
      'Quando um cliente compra o mesmo produto pelo menos duas vezes (com o cliente escolhido na venda), o sistema calcula de quanto em quanto tempo ele volta e prevê a próxima compra.',
      'Em Clientes → Hora de recomprar aparecem os que estão para voltar ou atrasados, com o botão Avisar, que abre o WhatsApp com a mensagem pronta.',
    ],
    keywords: ['recompra', 'lembrete', 'avisar cliente', 'whatsapp', 'voltar', 'fidelizar', 'racao acabando'],
    routes: ['/customers'],
  },
  {
    id: 'cadastrar-cliente',
    category: 'Clientes',
    question: 'Como cadastro ou altero um cliente?',
    answer: [
      'Em Clientes → Novo cliente, ou direto na tela de venda. Para alterar, clique no cliente e em Editar. Nas observações dá para anotar o nome do pet e a ração preferida.',
    ],
    keywords: ['cliente', 'cadastrar cliente', 'telefone', 'whatsapp', 'pet', 'editar cliente'],
    routes: ['/customers'],
  },
  {
    id: 'fiado',
    category: 'Clientes',
    question: 'Como vendo fiado?',
    answer: [
      '1. Na tela de venda, escolha o cliente (ou cadastre na hora).',
      '2. Na forma de pagamento, clique em Fiado. Aparece quanto ele já deve e o limite, se houver.',
      '3. Finalize. A notinha sai com o total em aberto e a linha para o cliente assinar.',
      'Também dá para pagar parte na hora: marque "Dividir em duas formas de pagamento" e escolha Fiado para o restante.',
      'Se a venda for cancelada ou um item for devolvido com "Abater do fiado", a dívida é corrigida sozinha.',
    ],
    keywords: ['fiado', 'pendura', 'pendurar', 'conta', 'prazo', 'depois', 'caderneta', 'anotar', 'marcar'],
    routes: ['/sales/new', '/customers'],
  },
  {
    id: 'receber-fiado',
    category: 'Clientes',
    question: 'O cliente veio pagar o fiado. Como registro?',
    answer: [
      '1. Em Clientes, clique no cliente (ou nele, na lista Fiado).',
      '2. Clique em Receber pagamento, informe o valor e a forma (dinheiro, Pix ou cartão). Pode ser só uma parte.',
      'Pagamento em dinheiro entra na conferência do caixa aberto. O extrato mostra cada compra, pagamento e o saldo.',
    ],
    keywords: ['pagar fiado', 'pagou', 'receber', 'quitar', 'abater', 'pagamento', 'acertar conta', 'baixar fiado'],
    routes: ['/customers', '/cash'],
  },
  {
    id: 'quem-deve',
    category: 'Clientes',
    question: 'Como vejo quem está me devendo e cobro?',
    answer: [
      'Em Clientes, o quadro Fiado mostra quem deve, quanto, desde quando e o último pagamento. O total a receber aparece no topo.',
      'O botão Cobrar abre o WhatsApp do cliente com uma mensagem educada e o valor em aberto.',
    ],
    keywords: ['devendo', 'deve', 'devedores', 'cobrar', 'cobranca', 'em aberto', 'a receber', 'caderneta'],
    routes: ['/customers'],
  },
  {
    id: 'limite-fiado',
    category: 'Clientes',
    question: 'Dá para colocar um limite de fiado para o cliente?',
    answer: [
      'Sim. Em Clientes, edite o cliente e preencha o Limite de fiado. Em branco, não há limite.',
      'A venda que passar do limite é recusada no caixa. Só gerente ou administrador define o limite.',
    ],
    keywords: ['limite', 'limite de fiado', 'maximo', 'teto', 'credito'],
    routes: ['/customers'],
  },
  {
    id: 'fiado-caderno',
    category: 'Clientes',
    question: 'Tenho fiados anotados no caderno. Como passo para o sistema?',
    answer: [
      '1. Em Clientes, cadastre o cliente (ou abra o que já existe) e clique em Editar.',
      '2. Preencha "Fiado anterior, do caderno" com o valor que ele deve hoje e salve.',
      'O valor entra no saldo do fiado como a dívida mais antiga e pode ser pago normalmente, inteiro ou em partes. Só gerente ou administrador lança esse valor.',
    ],
    keywords: ['caderno', 'anotado', 'antigo', 'anterior', 'passar', 'migrar', 'divida antiga', 'saldo anterior'],
    routes: ['/customers'],
  },

  {
    id: 'estornar-fiado',
    category: 'Clientes',
    question: 'Registrei um pagamento de fiado errado. Como desfaço?',
    answer: [
      'Em Clientes, abra o cliente e, no extrato do fiado, clique em "estornar" ao lado do pagamento. Escreva o motivo e confirme.',
      'O valor volta para a dívida do cliente e, se tinha sido em dinheiro, deixa de contar no caixa. O pagamento continua no extrato, riscado, e o estorno fica registrado em Alterações.',
      'Só gerente ou administrador estorna.',
    ],
    keywords: ['estornar', 'estorno', 'desfazer pagamento', 'pagamento errado', 'lancei errado', 'cancelar pagamento'],
    routes: ['/customers'],
  },
  {
    id: 'cartao-fidelidade',
    category: 'Clientes',
    question: 'Como funciona o cartão fidelidade?',
    answer: [
      'Em Configurações → Cartão fidelidade, crie a regra: por exemplo, a cada 10 da categoria Rações, ganha 1 petisco.',
      'O sistema conta sozinho as compras de cada cliente (é preciso escolher o cliente na venda). Devoluções e vendas canceladas não contam.',
      'No caixa, ao escolher o cliente, aparece quanto falta. Quando ele tiver direito, clique em Dar brinde: o produto entra na venda a R$ 0,00 e sai do estoque normalmente.',
    ],
    keywords: ['fidelidade', 'cartao fidelidade', 'pontos', 'brinde', 'ganha', 'premio', 'fidelizar', 'carimbo'],
    routes: ['/settings', '/sales/new', '/customers'],
  },
  {
    id: 'promocao',
    category: 'Vendas',
    question: 'Como coloco um produto em promoção?',
    answer: [
      '1. Em Promoções, clique em Nova promoção e escolha o produto.',
      '2. Escolha o tipo: preço promocional (ex.: de R$ 100 por R$ 85) ou leve X, pague Y (ex.: leve 3, pague 2).',
      '3. Defina quando começa e quando termina.',
      'No período, o caixa cobra o preço da promoção sozinho e mostra a economia na tela e na notinha. Depois do prazo, o preço volta ao normal. Para terminar antes, use Encerrar.',
    ],
    keywords: ['promocao', 'oferta', 'liquidacao', 'leve 3', 'pague 2', 'black friday', 'preco promocional'],
    routes: ['/promotions', '/sales/new'],
  },
  {
    id: 'categorias',
    category: 'Produtos e cadastros',
    question: 'Tem categoria repetida ou escrita errado. Como arrumo?',
    answer: [
      'Em Produtos, clique em Categorias. Aparecem todas, com quantos produtos há em cada.',
      'Renomear: muda o nome em todos os produtos de uma vez. Para juntar duas (ex.: "Racao" e "Rações"), renomeie uma com o nome exato da outra.',
      'Remover: os produtos ficam sem categoria. Se um cartão fidelidade usa a categoria, mude o cartão antes.',
    ],
    keywords: ['categoria', 'categorias', 'renomear', 'juntar', 'repetida', 'duplicada', 'escrita errado', 'agrupar'],
    routes: ['/products'],
  },
  {
    id: 'kit',
    category: 'Produtos e cadastros',
    question: 'Como monto um kit (vários produtos vendidos juntos)?',
    answer: [
      '1. Em Produtos → Novo produto, dê nome e preço ao kit e marque "É um kit".',
      '2. Abra o kit e, em Produtos do kit, adicione os itens e as quantidades (ex.: 1 ração, 2 petiscos, 1 brinquedo). Salve.',
      'O kit não tem estoque próprio: ao vender, sai do estoque cada produto que o compõe. A página mostra quantos kits dá para montar e o custo. Devolução e cancelamento devolvem os itens.',
    ],
    keywords: ['kit', 'combo', 'cesta', 'conjunto', 'pacote promocional', 'varios produtos'],
    routes: ['/products'],
  },
  {
    id: 'contas-pagar',
    category: 'Relatórios',
    question: 'Como controlo as contas a pagar (boletos, aluguel)?',
    answer: [
      'Em Contas a pagar, clique em Nova conta e informe descrição, valor e vencimento. Para aluguel e outras que se repetem, marque "Conta mensal": ao pagar, a do mês seguinte é lançada sozinha.',
      'As contas vencidas e as que vencem nos próximos 7 dias aparecem na tela inicial.',
      'Um pedido de compra também pode virar conta: abra o pedido e clique em Lançar conta a pagar.',
      'Só administrador e gerente veem as contas a pagar. Para os outros perfis, a tela não aparece no menu.',
    ],
    keywords: ['contas', 'boleto', 'aluguel', 'luz', 'agua', 'vencimento', 'pagar', 'despesa', 'contas a pagar'],
    routes: ['/bills', '/'],
  },
  {
    id: 'pagar-conta',
    category: 'Relatórios',
    question: 'Paguei uma conta com o dinheiro do caixa. Como registro?',
    answer: [
      'Em Contas a pagar, clique em Pagar na conta, escolha Dinheiro e marque "Paguei com o dinheiro da gaveta do caixa".',
      'O sistema registra a sangria no caixa aberto sozinho, para o fechamento bater.',
    ],
    keywords: ['paguei conta', 'dinheiro do caixa', 'gaveta', 'pagar conta', 'quitar boleto'],
    routes: ['/bills', '/cash'],
  },
  {
    id: 'fechamento-mes',
    category: 'Relatórios',
    question: 'Onde vejo o resumo do mês para mim ou para o contador?',
    answer: [
      'Relatórios → Fechamento do mês. Escolha o mês: aparecem faturamento, lucro, contas pagas, o resultado, o fiado vendido e recebido, as diferenças de caixa, o valor em estoque e os produtos mais vendidos.',
      'O botão Imprimir / PDF gera uma página para guardar ou mandar ao contador.',
    ],
    keywords: [
      'fechamento do mes',
      'resumo do mes',
      'contador',
      'resultado',
      'balanco do mes',
      'quanto sobrou',
      'lucro do mes',
    ],
    routes: ['/reports'],
  },

  /* ---------- Relatórios ---------- */
  {
    id: 'relatorio-vendas',
    category: 'Relatórios',
    question: 'Onde vejo quanto vendi e quanto lucrei?',
    answer: [
      'Relatórios → Vendas: faturamento, lucro, ticket médio, formas de pagamento e produtos mais vendidos no período escolhido. O resumo de hoje também aparece no Dashboard.',
    ],
    keywords: ['quanto vendi', 'faturamento', 'lucro', 'vendas do mes', 'vendas do dia', 'relatorio', 'ganhei'],
    routes: ['/reports'],
  },
  {
    id: 'pedido-fornecedor',
    category: 'Estoque',
    question: 'Como faço um pedido para o fornecedor?',
    answer: [
      '1. Em Relatórios → Sugestão de compra, clique em Gerar pedido ao lado do fornecedor.',
      '2. Confira as quantidades sugeridas, tire o que não quiser e escreva observações (prazo, forma de pagamento).',
      '3. Salve e clique em Enviar pelo WhatsApp (precisa do telefone no cadastro do fornecedor) ou em Imprimir / PDF.',
      'Enquanto o pedido não chega, a sugestão de compra não pede esses produtos de novo.',
    ],
    keywords: ['pedido', 'pedir', 'encomendar', 'fornecedor', 'comprar', 'orcamento', 'mandar pedido', 'whatsapp'],
    routes: ['/reports', '/purchase-orders'],
  },
  {
    id: 'pedido-chegou',
    category: 'Estoque',
    question: 'O pedido chegou. O que faço?',
    answer: [
      'Dê entrada na mercadoria pela Entrada por NF-e (com o XML da nota) ou por Nova movimentação → Entrada.',
      'Depois, em Pedidos de compra, abra o pedido e clique em Marcar como recebido. Se o fornecedor não for entregar, use Cancelar pedido.',
    ],
    keywords: ['pedido chegou', 'chegou', 'recebido', 'entregou', 'pedido de compra', 'receber pedido'],
    routes: ['/purchase-orders'],
  },
  {
    id: 'sugestao-compra',
    category: 'Relatórios',
    question: 'Como sei o que preciso comprar?',
    answer: [
      'Relatórios → Sugestão de compra. Pelo ritmo de vendas, o sistema mostra o que vai acabar antes da próxima compra e quanto pedir, separado por fornecedor.',
      'Escolha quantos dias de estoque quer comprar (ex.: 15 dias). Dá para exportar para o Excel e mandar ao fornecedor.',
    ],
    keywords: ['comprar', 'pedido', 'sugestao', 'o que comprar', 'repor', 'fornecedor', 'acabando'],
    routes: ['/reports'],
  },
  {
    id: 'parados',
    category: 'Relatórios',
    question: 'Como vejo os produtos que não vendem?',
    answer: [
      'Relatórios → Produtos parados: produtos com estoque que não saem há um tempo, e quanto dinheiro está parado neles. Bons candidatos a promoção ou a não recomprar.',
    ],
    keywords: ['parado', 'encalhado', 'nao vende', 'sem saida', 'promocao', 'dinheiro parado'],
    routes: ['/reports'],
  },
  {
    id: 'excel',
    category: 'Relatórios',
    question: 'Consigo levar os relatórios para o Excel?',
    answer: ['Sim. Todo relatório e o histórico têm o botão CSV, que baixa um arquivo que abre direto no Excel.'],
    keywords: ['excel', 'csv', 'exportar', 'planilha', 'baixar', 'contador'],
    routes: ['/reports', '/movements'],
  },

  /* ---------- Usuários e senhas ---------- */
  {
    id: 'usuarios',
    category: 'Usuários e senhas',
    question: 'Como crio um acesso para um funcionário?',
    answer: [
      'Usuários → Novo usuário (só o administrador). Escolha o perfil:',
      'Operador: vende, abre e fecha o caixa, dá entrada e saída e conta inventário.',
      'Gerente: tudo do operador, mais cadastros, preços, cancelamentos, devoluções, relatórios, configurações e contas a pagar.',
      'Administrador: tudo, inclusive usuários. Somente leitura: só consulta.',
      'A senha criada é temporária: o funcionário escolhe a dele no primeiro acesso.',
    ],
    keywords: ['usuario', 'funcionario', 'acesso', 'login', 'perfil', 'permissao', 'vendedor', 'atendente'],
    routes: ['/users'],
  },
  {
    id: 'trocar-senha',
    category: 'Usuários e senhas',
    question: 'Como troco a minha senha?',
    answer: ['Clique no ícone de chave ao lado do seu nome, no canto de baixo do menu.'],
    keywords: ['trocar senha', 'mudar senha', 'alterar senha', 'senha'],
  },
  {
    id: 'esqueci-senha',
    category: 'Usuários e senhas',
    question: 'Esqueci a senha. E agora?',
    answer: [
      'Funcionário: o administrador abre Usuários, edita o usuário e define uma senha nova (temporária).',
      'Administrador: no computador da loja, menu Ajuda → Redefinir senha do administrador. O programa mostra uma senha temporária, que precisa ser trocada no primeiro acesso.',
    ],
    keywords: [
      'esqueci',
      'senha',
      'nao consigo entrar',
      'nao entra',
      'entrar no sistema',
      'bloqueado',
      'recuperar',
      'resetar',
      'login',
      'acesso',
    ],
  },
  {
    id: 'quem-alterou',
    category: 'Usuários e senhas',
    question: 'Como sei quem alterou um preço ou cancelou uma venda?',
    answer: [
      'Em Alterações: cada mudança de cadastro, preço, usuário, configuração, cancelamento, devolução e fechamento de caixa fica registrada com quem fez, quando, o valor antigo e o novo. Ninguém consegue apagar esse registro.',
    ],
    keywords: ['quem alterou', 'quem mudou', 'auditoria', 'registro', 'alteracoes', 'log', 'rastrear'],
    routes: ['/audit'],
  },

  /* ---------- Backup e problemas ---------- */
  {
    id: 'backup',
    category: 'Backup e problemas',
    question: 'Meus dados estão seguros? Como funciona o backup?',
    answer: [
      'O programa faz um backup por dia no próprio computador e outro antes de cada atualização.',
      'Para se proteger se o computador estragar ou for roubado, ative em Configurações → Cópia de segurança fora do computador, apontando para um pendrive ou uma pasta do Google Drive/OneDrive. Uma cópia vai para lá todo dia.',
      'Backup na hora: menu Arquivo → Fazer backup agora (Ctrl+B).',
      'Se a cópia fora do computador não estiver configurada ou estiver falhando, aparece um aviso na tela inicial.',
    ],
    keywords: ['backup', 'copia', 'seguranca', 'perder dados', 'pendrive', 'google drive', 'onedrive', 'salvar'],
    routes: ['/settings'],
  },
  {
    id: 'restaurar',
    category: 'Backup e problemas',
    question: 'Como volto um backup?',
    answer: [
      'Menu Arquivo → Restaurar backup e escolha o arquivo (da pasta de backups, do pendrive ou da pasta sincronizada).',
      'Antes de restaurar, o programa guarda uma cópia dos dados atuais. Depois ele reinicia sozinho.',
    ],
    keywords: ['restaurar', 'voltar backup', 'recuperar dados', 'computador novo', 'formatar'],
  },
  {
    id: 'computador-novo',
    category: 'Backup e problemas',
    question: 'Troquei de computador. Como levo os dados?',
    answer: [
      '1. No computador antigo: Arquivo → Fazer backup agora e salve num pendrive.',
      '2. No novo: instale o EstoqueIn, crie um acesso qualquer na primeira tela e use Arquivo → Restaurar backup com o arquivo do pendrive.',
      'Depois disso, valem os usuários e senhas do backup.',
    ],
    keywords: ['computador novo', 'trocar computador', 'formatar', 'mudar de pc', 'levar dados'],
  },
  {
    id: 'diagnostico',
    category: 'Backup e problemas',
    question: 'Deu um erro. Como peço ajuda?',
    answer: [
      '1. No menu Ajuda → Gerar arquivo de diagnóstico, salve o arquivo (ele não leva dados de clientes nem o banco).',
      '2. Clique em Falar com o suporte, aqui na ajuda, e envie o arquivo pelo WhatsApp, contando o que estava fazendo.',
    ],
    keywords: ['erro', 'problema', 'travou', 'bug', 'nao funciona', 'suporte', 'diagnostico', 'ajuda'],
  },
  {
    id: 'atualizar',
    category: 'Backup e problemas',
    question: 'Como atualizo o programa?',
    answer: [
      'Execute o instalador da versão nova por cima da atual. Os dados são mantidos, e o programa guarda uma cópia de segurança antes de atualizar o banco.',
      'A versão instalada aparece em Ajuda → Sobre o EstoqueIn.',
    ],
    keywords: ['atualizar', 'atualizacao', 'versao nova', 'instalar', 'nova versao'],
  },
];

/* ---------- Busca ---------- */

const STOPWORDS = new Set(
  'a o as os um uma uns umas de da do das dos em no na nos nas por para pra pro com sem e ou que se eu meu minha meus minhas me mim voce ele ela isso esse essa este esta aqui ali la como onde quando qual quais quero queria preciso posso consigo da dar fazer faco faz ja nao sim mais muito pelo pela ao aos tem ter tenho foi ser esta estou sao the'.split(
    ' ',
  ),
);

/** Minúsculas, sem acento e sem pontuação. */
export const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');

const tokenize = (text: string) =>
  normalize(text)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));

/** Palavras "iguais" com variação de final (devolver/devolução, vendas/venda, cancelei/cancelar). */
const sameWord = (a: string, b: string) => {
  if (a === b) return true;
  const size = Math.min(a.length, b.length);
  if (size < 4) return false;
  const stem = Math.max(4, size - 2);
  return a.slice(0, stem) === b.slice(0, stem);
};

interface Indexed {
  article: HelpArticle;
  question: string[];
  keywords: string[];
  phrases: string[];
  answer: string[];
}

const INDEX: Indexed[] = HELP_ARTICLES.map((article) => ({
  article,
  question: tokenize(article.question),
  keywords: article.keywords.flatMap(tokenize),
  phrases: article.keywords.filter((keyword) => keyword.includes(' ')).map(normalize),
  answer: tokenize(article.answer.join(' ')),
}));

export interface HelpMatch {
  article: HelpArticle;
  score: number;
}

/** Perguntas mais parecidas com o texto, da melhor para a pior. */
export function searchHelp(query: string, limit = 5): HelpMatch[] {
  const words = tokenize(query);
  if (words.length === 0) return [];
  const text = normalize(query);
  // Palavras raras ("encalhado", "sangria") dizem mais sobre a dúvida que palavras comuns ("produto", "venda").
  const weight = new Map(
    words.map((word) => {
      const found = INDEX.filter(
        (entry) =>
          entry.question.some((token) => sameWord(word, token)) ||
          entry.keywords.some((token) => sameWord(word, token)),
      ).length;
      return [word, found === 0 ? 1 : Math.min(3, Math.log(INDEX.length / found))];
    }),
  );
  return INDEX.map(({ article, question, keywords, phrases, answer }) => {
    let score = 0;
    for (const word of words) {
      const w = weight.get(word)!;
      if (keywords.some((keyword) => sameWord(word, keyword))) score += 3 * w;
      if (question.some((token) => sameWord(word, token))) score += 3 * w;
      // Palavra que só aparece no texto da resposta vale pouco, mesmo se for rara.
      else if (answer.some((token) => sameWord(word, token))) score += Math.min(w, 1);
    }
    // Expressões inteiras ("fechar caixa", "nota fiscal") valem mais que palavras soltas.
    for (const phrase of phrases) if (text.includes(phrase)) score += 4;
    return { article, score: score / Math.sqrt(words.length) };
  })
    .filter((match) => match.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Perguntas da tela atual (a rota mais específica primeiro). */
export function articlesForRoute(pathname: string) {
  const path = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  const exact = HELP_ARTICLES.filter((article) => article.routes?.includes(path));
  if (exact.length) return exact;
  // Telas de detalhe (/products/123) usam as perguntas da lista (/products).
  const base = '/' + path.split('/')[1];
  return HELP_ARTICLES.filter((article) => article.routes?.includes(base));
}
