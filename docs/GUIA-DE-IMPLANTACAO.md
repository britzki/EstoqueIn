# Guia de implantação do EstoqueIn

Roteiro para instalar o programa num cliente novo. Leva cerca de uma hora, sem contar o cadastro dos produtos.

## 1. Antes de instalar: três cuidados no computador

O EstoqueIn guarda tudo no próprio computador da loja. A segurança dos dados depende destes três pontos, que são configurações do Windows e do uso, não do programa.

- [ ] **Senha no usuário do Windows.** Sem ela, qualquer pessoa que sente no computador abre o programa, copia o banco de dados ou redefine a senha do administrador pelo menu Ajuda. Configure também o bloqueio automático de tela.
- [ ] **Criptografia do disco (BitLocker).** O banco de dados não é criptografado. Com o BitLocker ativo, se o computador for roubado, os dados não podem ser lidos. Fica em *Configurações → Privacidade e segurança → Criptografia do dispositivo* (disponível no Windows Pro e em parte dos computadores com Windows Home).
- [ ] **Um usuário do sistema para cada funcionário.** Nada de todos usarem o acesso do dono. Cada venda, movimentação e alteração fica registrada com o nome de quem fez, e o perfil certo impede que o balconista altere preços ou cancele vendas.

## 2. Instalação

- [ ] Rodar o `EstoqueIn-Setup-<versão>.exe`. No aviso "o Windows protegeu o computador", clicar em **Mais informações → Executar assim mesmo** (o instalador ainda não tem assinatura digital).
- [ ] Na primeira abertura, criar o acesso do administrador (o dono) e dar nome ao estoque.

## 3. Configurar a loja

Em **Gestão → Configurações**:

- [ ] Nome, CNPJ, endereço e telefone (saem na notinha).
- [ ] Largura da bobina (58 ou 80 mm) e a impressora da notinha. Com a impressora escolhida, a notinha sai direto, sem janela de confirmação.
- [ ] **Vendas e caixa:** deixar ligado "Exigir caixa aberto para vender" se o dono quiser conferir a gaveta todo dia e preencher o **troco fixo da gaveta** (o valor que fica nela de um dia para o outro, ex.: R$ 250,00). Decidir com ele se a loja pode vender produto com estoque zerado (o saldo fica negativo e aparece um alerta para conferir).
- [ ] Formato da etiqueta da balança. Recomendado: a balança gravar o **peso** na etiqueta. Bipar uma etiqueta de teste na tela de venda para conferir.

Em **Gestão → Usuários**:

- [ ] Criar um usuário para cada funcionário, com o perfil adequado:
  - **Operador:** vende, dá entrada e saída, conta inventário.
  - **Gerente:** também cadastra produtos, altera preços, cancela vendas, vê relatórios e cuida das contas a pagar.
  - **Administrador:** tudo, inclusive usuários.
  - Faturamento, lucro, custos, valor do estoque e relatórios só aparecem para **Administrador** e **Gerente**. O operador vê só o que precisa para vender e conferir a gaveta.
- [ ] A senha criada pelo administrador é temporária: o funcionário define a própria no primeiro acesso.

## 4. Trazer os dados do sistema antigo

Em **Produtos → Importar CSV**, com o botão **Baixar modelo** para ver o formato.

- [ ] Exportar a lista de produtos do sistema antigo para Excel e salvar como CSV.
- [ ] Ajustar os nomes das colunas. As principais: `sku`, `nome`, `codigo_barras`, `categoria`, `unidade`, `preco_custo`, `preco_venda`, `estoque_minimo`.
- [ ] Para já entrar com o estoque certo, incluir a coluna **`saldo`** com a quantidade atual de cada produto.
- [ ] Produtos vendidos por peso: unidade `KG` (ou `fracionado` = sim) e, se usar balança etiquetadora, a coluna `codigo_balanca`.
- [ ] Conferir a pré-visualização: ela mostra o que será criado, o que será atualizado e as linhas com erro, sem gravar nada.

Depois:

- [ ] Para ração a granel: abrir o cadastro do saco fechado e usar **Criar versão a granel**.
- [ ] Marcar como **Botão rápido na tela de venda** os produtos que mais saem (ração a granel, por exemplo).
- [ ] Se a loja quiser, criar o **cartão fidelidade** em Configurações (ex.: a cada 10 sacos de ração, 1 petisco de brinde).
- [ ] Lançar em **Contas a pagar** as contas fixas do mês (aluguel, luz, internet) marcando "Conta mensal".
- [ ] **Entregas:** em Configurações → Entregas, conferir a taxa, o valor para entrega grátis e o prazo. Cadastrar o entregador (ex.: o motoboy) com o valor que a loja paga por entrega.
- [ ] Kits vendidos na loja: cadastrar como produto, marcar **É um kit** e escolher os itens na página do produto.
- [ ] **Fiado do caderno:** cadastrar em Clientes quem está devendo e preencher **Fiado anterior, do caderno** com o valor que cada um deve hoje. Definir o limite de fiado de quem precisar.
- [ ] Preencher o **telefone (WhatsApp) dos fornecedores**, para enviar os pedidos de compra direto.
- [ ] Fornecedores e produtos novos entram sozinhos pelas próximas notas, em **Entrada por NF-e**.

O histórico de vendas do sistema antigo não é migrado: o cliente consulta o passado no sistema anterior.

## 5. Backup fora do computador

O programa faz backup automático todo dia e antes de cada atualização, mas **na mesma máquina**. Se o computador queimar ou for roubado, esses backups vão junto.

- [ ] Em **Configurações → Cópia de segurança fora do computador**, clicar em **Escolher pasta** e apontar para uma pasta do Google Drive ou OneDrive (instalados no computador) ou para um pendrive que fique sempre conectado. A primeira cópia é feita na hora; depois, uma por dia.
- [ ] Conferir que apareceu "Funcionando" e que o arquivo `estoquein-copia-....db` está na pasta.
- [ ] Mostrar onde fica **Arquivo → Restaurar backup** (é por ele que se volta uma cópia, inclusive a do pendrive).

## 6. Treinamento rápido

- [ ] **Caixa:** abrir de manhã (o troco já vem preenchido), registrar sangrias (dinheiro tirado da gaveta durante o dia) e fechar à noite contando o dinheiro. O sistema diz quanto retirar e quanto deixa na gaveta. Imprimir o comprovante do fechamento e guardar junto com o dinheiro retirado.
- [ ] **Nova venda:** bipar, F2 para finalizar, F4 para voltar à leitura. Escolher o cliente (ou cadastrar com o WhatsApp) para ele entrar no lembrete de recompra.
- [ ] **Devolução:** em **Vendas**, abrir a venda e usar **Devolver itens**. Cancelar só quando a venda inteira foi um erro.
- [ ] **Clientes → Hora de recomprar:** quem costuma levar ração e está perto de acabar, com o botão para avisar pelo WhatsApp.
- [ ] **Fiado:** vender no fiado (escolher o cliente e a forma Fiado), receber pagamento em Clientes e usar o botão Cobrar.
- [ ] **Entregas:** na venda, marcar "É para entregar", escolher o endereço e se já está pago ou se cobra na entrega. Em **Entregas**, usar Saiu (com o entregador), Avisar (WhatsApp) e Entregue. Imprimir a guia para ir junto com o pacote.
- [ ] **Pedidos de compra:** gerar o pedido pela sugestão de compra e marcar como recebido quando chegar.
- [ ] **Promoções:** criar com data de início e fim; o caixa cobra sozinho.
- [ ] **Contas a pagar:** pagar pela tela (com dinheiro da gaveta, se for o caso) e acompanhar o aviso na tela inicial.
- [ ] **Fechamento do mês** (Relatórios): imprimir no começo de cada mês para o dono ou o contador.
- [ ] **Ajuda:** mostrar a tecla F1 e o botão Falar com o suporte.
- [ ] **Relatórios → Sugestão de compra** antes de fazer o pedido ao fornecedor, e **Produtos parados** de tempos em tempos.
- [ ] **Entrada por NF-e:** enviar o XML que o fornecedor manda por e-mail.
- [ ] **Abrir para granel**, quando abrir um saco para vender por peso.
- [ ] **Alertas:** o que significam e o botão Repor.
- [ ] **Inventário:** contagem com o leitor.

## Se o administrador esquecer a senha

No computador da loja: **Ajuda → Redefinir senha do administrador**. O programa mostra uma senha temporária, que precisa ser trocada no primeiro acesso. A redefinição fica no registro de alterações (**Gestão → Alterações**).

## Se der algum problema

Primeiro, a ajuda do próprio programa: **F1** (ou o botão **Ajuda e dúvidas** no menu) responde as dúvidas mais comuns e tem o botão **Falar com o suporte**, que abre o WhatsApp do suporte com a versão já escrita.

Se for um erro, pedir ao cliente: **Ajuda → Gerar arquivo de diagnóstico** e enviar o arquivo salvo na área de trabalho. Ele traz versão, estado do banco, backups e o registro de erros, sem dados de clientes nem o banco em si.

## Atualizações

Enviar o instalador novo e instalar por cima. Os dados são mantidos, e o programa guarda uma cópia de segurança antes de alterar o banco.
