# PhotoSort

Aplicação privada para organizar fotografias de corridas de rua por rajadas de captura. A interface principal é a aplicação React, TypeScript e Vite. `PhotoSort IA.html` é um protótipo legado e não é usado pelo servidor Vite.

## Executar localmente

```bash
npm install
npm run dev
```

Validação de produção:

```bash
npm run build
npm run lint
npm test
```

## Configurar Supabase

1. Crie um projeto Supabase.
2. No SQL Editor desse projeto, aplique [a migração inicial](./supabase/migrations/20261114000000_private_photo_workspace.sql). Ela cria as tabelas `events` e `photos`, políticas RLS por proprietário e o bucket privado `photos`. Se já aplicou essa migração, execute também [a atualização do limite Free](./supabase/migrations/20261114000001_free_plan_file_size_limit.sql), [a correção das políticas RLS do Storage](./supabase/migrations/20261114000002_fix_storage_path_rls.sql), [a coluna da capa da corrida](./supabase/migrations/20261114000003_event_cover_photo.sql) e a nova [migração de classificação por rajada](./supabase/migrations/20261121000000_burst_classification.sql).
3. Configure autenticação por e-mail e senha, desative a criação pública de contas e provisione somente a conta privada do fotógrafo.
4. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com a URL do projeto e a chave pública `anon`/publishable.
5. Inicie novamente `npm run dev`. Sem essas variáveis, o app permite criar apenas rascunhos locais; as fotografias não são enviadas.
6. Em produção, configure as mesmas duas variáveis como variáveis de ambiente da Vercel e faça um novo deploy.

A chave `anon`/publishable é usada pelo frontend e depende das políticas RLS da migração. **Nunca** use `service_role`, chaves secretas ou credenciais administrativas em variáveis `VITE_*`.

No Supabase, abra **Storage → Settings** e configure o **Global file size limit** para **50 MB ou menos**. O limite do bucket `photos` também fica em 50 MB. O plano Free não permite aumentar o limite global acima de 50 MB; cotas de armazenamento e transferência se aplicam ao projeto inteiro.

## Organizador local por rajadas

- Ao cadastrar uma corrida conectada ao Supabase, selecione uma pasta ou imagens e escolha o intervalo máximo. O PhotoSort analisa o EXIF no navegador, mostra um resumo para conferência e então envia os originais já classificados em pastas privadas por rajada. Não é necessário selecionar as fotos novamente.
- As fotos selecionadas, excedentes e itens para revisão são todos mantidos. A nova migração adiciona classificação, horário EXIF e dados da câmera à tabela `photos`, além de conceder permissões de tabela ao papel `authenticated`; as políticas RLS existentes continuam limitando o acesso ao proprietário.
- Abra **Organizar rajadas** (`/processamentos`) e selecione uma pasta ou várias imagens. A leitura EXIF, o cálculo SHA-256 e a criação do ZIP acontecem no navegador; os arquivos escolhidos nesta página não são enviados ao Supabase.
- Formatos de imagem são selecionados localmente. JPG, JPEG, TIFF, PNG e WEBP são reconhecidos para análise quando contêm metadados compatíveis.
- O horário de captura usa `DateTimeOriginal` + `SubSecTimeOriginal`, depois `DateTimeDigitized` + `SubSecTimeDigitized` e, por fim, `DateTime` + `SubSecTime`. A data de modificação do arquivo nunca substitui um horário EXIF ausente.
- Frações de segundo EXIF são preservadas na ordenação. Datas sem fuso explícito são comparadas como horários EXIF de parede; offsets explícitos são normalizados para UTC.
- O fotógrafo informa o intervalo máximo entre capturas para agrupar cada rajada. Essa configuração (por exemplo, 2 segundos) não altera o limite de FPS.
- Sequências são agrupadas por câmera identificável e ordenadas cronologicamente. Timestamps iguais são capturas distintas e permanecem elegíveis; câmeras não identificáveis e metadados ausentes ou inválidos vão para revisão.
- O limite é de 10 fotos em qualquer janela móvel de 1.000 ms, contando os dois extremos (`[início, início + 1.000 ms]`). Não há divisão pelo segundo do relógio e cada arquivo recebe uma única classificação. Em uma sequência contida em uma janela, são mantidas as 10 posições centrais; em janelas sobrepostas, a seleção maximiza as fotos mantidas e usa a centralidade como desempate.
- Resultados locais de versões anteriores são recalculados a partir dos metadados já salvos ao abrir o organizador, sem reprocessar ou alterar os arquivos originais.
- O ZIP inclui `FOTOS_COMPLETAS`, `FOTOS_EXCEDENTES`, `REVISAO` e `RELATORIO.txt`. Imagens são armazenadas no ZIP sem recompressão; SHA-256 identifica cópias exatas sem removê-las.
- O navegador salva automaticamente os arquivos selecionados, o intervalo e os resultados no IndexedDB, separados pelo ID da conta conectada. Os dados ficam somente nesse navegador e aparelho; não são enviados ao Supabase nem sincronizados entre dispositivos.
- Ao voltar à mesma conta no mesmo navegador, a seleção e os resultados concluídos são restaurados. Se a página for fechada durante a análise, os arquivos continuam salvos, mas a análise precisa ser iniciada novamente.
- Limpar a seleção no organizador também apaga a cópia local dos arquivos e resultados desse processamento. Isso não apaga os originais escolhidos no computador nem um ZIP já baixado. Apagar os dados do site no navegador também remove o salvamento local.
- Em navegadores com suporte ao seletor de gravação, o ZIP é escrito diretamente no destino escolhido pela janela do sistema. Em navegadores sem esse suporte (como pode ocorrer no Safari), o download segue a configuração padrão do navegador; no Mac, Chrome ou Edge atualizados permitem escolher a pasta.
- O navegador pode impor limites de armazenamento. Se não for possível salvar localmente, o organizador informa o erro; mantenha a página aberta e baixe o ZIP antes de sair. Nenhum original no computador é alterado ou apagado.

## Perfil e aparência

- **Meu perfil** salva o nome em `user_metadata.full_name` do usuário autenticado pelo Supabase Auth. A atualização usa a sessão atual e não altera o e-mail de login; nenhuma tabela ou migração adicional é necessária.
- A aparência usa Inter, tema claro por padrão e tema escuro opcional. A preferência de tema continua salva localmente no navegador.

## Estrutura

- `src/auth` — sessão Supabase e login privado.
- `src/domain` — modelos e tipos do banco.
- `src/services` — acesso autenticado a eventos, Storage e preferências.
- `supabase/migrations` — tabelas, índices, RLS e bucket privado.
- `src/index.css` — tema, componentes visuais e responsividade.

## Estado desta etapa

- A autenticação, o cadastro de corridas, os uploads privados e a galeria do Supabase continuam disponíveis.
- O perfil permite atualizar o próprio nome nos metadados do Supabase Auth, sem alterar o e-mail ou criar uma tabela.
- O organizador local implementa leitura de EXIF, agrupamento por intervalo configurável, limite móvel de 10 FPS, seleção central determinística, identificação SHA-256 de duplicatas, revisão e exportação ZIP.
- O limite móvel de 10 fotos por 1.000 ms, o agrupamento independente e o particionamento total das fotos têm testes automatizados (`npm test`).
- O repositório não contém uma amostra de fotografias reais; os intervalos ainda precisam ser calibrados com imagens das câmeras usadas pelo fotógrafo.
- O processamento local não grava jobs ou imagens no banco. A seleção e os resultados concluídos são restaurados do navegador; um processamento interrompido precisa ser iniciado novamente.
- Reconhecimento facial, identificação de atletas, avaliação estética e seleção por IA não fazem parte do produto.
