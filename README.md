# Casa de Pinheiro

Página em português para o Pinheiro Canadense de Natal Greycom. A oferta Black Friday custa R$ 87,90 por unidade no Pix para a versão de 1,80 m com 800 galhos. As fotos, a ficha técnica e as avaliações vêm do anúncio original do produto.

## Executar localmente

Na raiz do projeto, execute com Node.js 22 ou 24:

    npm start

Abra http://localhost:3000. O catálogo funciona enquanto o checkout aguarda configuração. A função de pagamento fica em /api/checkout.

## Hospedar na Namecheap

1. No **File Manager** do cPanel, extraia o pacote em uma pasta da conta chamada casa-de-pinheiro, fora de public_html.
2. Em **Setup Node.js App**, crie uma aplicação em modo **Production** com Node.js 24, ou 22 quando essa for a versão disponível.
3. Defina **Application root** como casa-de-pinheiro, escolha o domínio ou subdomínio em **Application URL**, use a raiz do endereço e preencha **Application startup file** com server.js.
4. Cadastre as variáveis da seção MangoFy em **Environment variables**. Inicie ou reinicie a aplicação.
5. Confira se o domínio aponta para a hospedagem e abre com HTTPS. Verifique o produto, a oferta e o destino do botão de compra antes de divulgar o endereço.

O servidor usa os módulos incluídos no Node.js. A instalação de pacotes é dispensável.

[Setup Node.js App no cPanel da Namecheap](https://www.namecheap.com/support/knowledgebase/article.aspx/10047/2182/how-to-work-with-nodejs-app/)

## Configurar a MangoFy

Para usar o checkout hospedado, configure MANGOFY_CHECKOUT_URL com o link público da oferta criada na MangoFy. Configure R$ 87,90 por unidade e Pix na oferta do painel. O preço da página vem do código e o checkout hospedado usa o preço cadastrado na MangoFy.

O Pix gerado na própria página usa a API V1 da MangoFy. Para habilitar essa modalidade numa oferta com frete grátis, configure MANGOFY_PIX_FREE_SHIPPING como true e deixe MANGOFY_CHECKOUT_URL vazia. Ela usa estas variáveis de servidor:

- MANGOFY_API_BASE_URL recebe a URL HTTPS de API liberada pelo gestor da integração.
- MANGOFY_API_KEY recebe a credencial do cabeçalho Authorization, como variável sensível.
- MANGOFY_STORE_CODE recebe o Store Code da integração API customizada.

A função calcula o total em centavos, gera o Pix e verifica o pagamento pela API. A confirmação só aparece após a consulta de um pagamento aprovado com o mesmo identificador e valor. O endereço do pedido é enviado como metadado à MangoFy na modalidade de frete grátis. Confirme com o gestor a liberação do IP, se exigida, e o acesso aos metadados para atender pedidos físicos antes de habilitar essa modalidade.

Os valores de credenciais ficam no ambiente do servidor. O endpoint público informa apenas a modalidade, o preço e o link hospedado, quando configurado.

[Documentação da API da MangoFy](https://app.mangofy.com.br/checkout/doc)

## Publicar na Vercel

Importe a raiz do repositório na Vercel. A página usa HTML, CSS e JavaScript e a rota de checkout roda como Vercel Function em api/checkout.mjs. Para vendas reais, use um plano que permita uso comercial.
