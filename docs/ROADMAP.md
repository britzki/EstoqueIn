# Planejamento do EstoqueIn

Decisões já tomadas e o que fica para depois. A ordem dentro de cada seção é a ordem combinada.

## Situação atual

- Programa instalado no Windows, um computador por loja, dados locais, funciona sem internet.
- Primeiro cliente: pet shop (farmácia, acessórios e ração em pacote e a granel), sem serviços.
- Venda sem valor fiscal (notinha). A nota fiscal continua sendo emitida por fora.

## Próximos passos

Já feito na versão 1.6: fiado (caderneta digital com limite, pagamentos parciais e cobrança pelo WhatsApp), botões rápidos na tela de venda, pedidos de compra a partir da sugestão e aviso de backup na tela inicial.

Já feito na versão 1.5: fechamento de caixa, venda com estoque zerado (opcional, com alerta), devolução parcial, cadastro de clientes com lembrete de recompra, sugestão de compra, relatório de produtos parados, cópia diária para fora do computador e arquivo de diagnóstico.

1. **Modo demonstração separado.** Banco próprio, com entrada pela tela de login e saída a qualquer momento, sem misturar com os dados reais. Serve de vitrine para quem está avaliando.
2. **Licença offline anual.** Arquivo assinado com cliente, validade e plano, amarrado ao computador (o programa mostra um "código desta máquina"). Vencida, o sistema entra em modo somente leitura: consulta, exporta e faz backup, mas não lança movimentações. Inclui o gerador de chaves, com a chave secreta fora do repositório.
3. **Atualização automática** do programa instalado, antes de haver muitos clientes.

## Para o futuro

### Acesso pelo celular

- **Primeiro passo: rede da loja.** O computador serve o sistema pelo Wi‑Fi e o celular abre pelo navegador, com ícone na tela inicial (aplicativo instalável pelo navegador). Sem custo de hospedagem. Uso típico: conferir estoque e fazer inventário andando pela loja.
- Câmera do celular como leitor de código de barras.
- Aplicativo nas lojas (Play Store e App Store) só se houver demanda: exige contas pagas, revisão a cada atualização e uma segunda base de código.

### Licença híbrida

O programa ativa online e recebe uma licença válida por alguns dias, renovada sozinha quando há internet. Permite bloqueio na hora, mensalidade e painel de clientes. O formato do arquivo de licença é o mesmo da versão offline; muda só quem emite. Custo estimado do servidor: R$ 40 a R$ 500 por ano.

### Versão em nuvem

Dados num servidor, com acesso de qualquer lugar e cobrança por mensalidade. Custo estimado: R$ 50 a R$ 250 por mês para os primeiros 20 a 50 clientes.

Exige que cada cliente enxergue só os próprios dados (hoje o sistema supõe uma empresa por instalação), o que mexe em quase todas as consultas.

### Modo offline com sincronização (pedido registrado)

**Objetivo:** na versão em nuvem, a loja continuar vendendo sem internet e os dados se acertarem sozinhos quando a conexão voltar.

É a parte mais difícil do projeto, e deve ser feita mesmo assim. Os pontos que precisam de decisão:

- **Onde a venda offline é gravada:** banco local no computador da loja (o que o programa desktop já tem) e uma fila de operações pendentes de envio.
- **Conflitos de estoque:** duas pontas podem vender a mesma unidade enquanto estão sem conexão. O caminho mais seguro é sincronizar as *movimentações* (que só se acumulam) e recalcular o saldo, em vez de sincronizar o saldo. Saldo negativo depois da sincronização vira um alerta para conferência, não um erro.
- **Numeração das vendas:** números sequenciais por computador (ex.: prefixo do caixa), para não colidir.
- **Cadastros:** alterações de preço e produto feitas na nuvem precisam chegar às lojas; a regra de "quem vence" em caso de edição nos dois lados tem de ser definida.
- **Identificadores:** já são gerados sem depender do servidor, o que ajuda.

Ponto de partida natural: o programa desktop atual vira a "ponta offline", e a nuvem recebe as movimentações dele.

### Fiscal

- Emissão de NFC-e (cupom fiscal ao consumidor) por um serviço de emissão, como plano mais caro. Em São Paulo, confirmar com o contador a obrigação vigente (SAT em transição para NFC-e).
- Buscar na SEFAZ as NF-e emitidas contra o CNPJ, sem esperar o XML do fornecedor (exige certificado digital A1).

### Assistente com IA

Hoje o assistente da central de ajuda funciona sem internet, buscando nas perguntas frequentes. Quando o projeto amadurecer, um chatbot com IA pode responder perguntas escritas de qualquer jeito, usando essas mesmas perguntas como base de conhecimento.

- Exige internet e um servidor intermediário (a chave da IA não pode ir dentro do instalador). Pode ser o mesmo servidor da licença híbrida.
- Custo de poucos centavos por pergunta.
- Responder sobre os dados da loja ("quanto vendi hoje") significa enviar dados para fora do computador: avaliar a LGPD antes.

### Produto

- Validade e lote (vender primeiro o que vence antes), relevante para farmácia veterinária. O primeiro cliente não faz questão por enquanto.
- Balança ligada direto ao computador, com o peso aparecendo na tela de venda (depende do modelo).

### Distribuição

- Certificado de assinatura de código, para o Windows não exibir o aviso de "editor desconhecido". Fica para quando houver retorno.
