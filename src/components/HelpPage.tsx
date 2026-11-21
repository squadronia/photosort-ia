import type { ReactNode } from 'react'
import { ChevronDown, CircleHelp } from 'lucide-react'
import { Link } from 'react-router-dom'

function HelpGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel help-group">
      <h2 className="section-title">{title}</h2>
      <div className="help-modules">{children}</div>
    </section>
  )
}

function HelpModule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="help-module">
      <summary>
        <span>{title}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <div className="help-module-body">{children}</div>
    </details>
  )
}

export function HelpPage() {
  return (
    <div className="help-page">
      <header className="page-heading">
        <div>
          <h1>Como usar o sistema</h1>
          <p>Orientações para cada área do PhotoSort e soluções para problemas comuns.</p>
        </div>
      </header>

      <div className="notice notice-info">
        <CircleHelp size={17} />
        <span>
          Corridas e fotos enviadas ficam no workspace privado do Supabase. O Organizador de rajadas
          processa e salva os arquivos localmente neste navegador; ele não sincroniza essa seleção com
          outros dispositivos.
        </span>
      </div>

      <nav aria-label="Atalhos do sistema" className="help-quick-links">
        <Link className="button button-secondary" to="/">Visão geral</Link>
        <Link className="button button-secondary" to="/novo">Nova corrida</Link>
        <Link className="button button-secondary" to="/eventos">Minhas corridas</Link>
        <Link className="button button-secondary" to="/processamentos">Organizar rajadas</Link>
        <Link className="button button-secondary" to="/armazenamento">Armazenamento</Link>
        <Link className="button button-secondary" to="/configuracoes">Configurações</Link>
      </nav>

      <HelpGroup title="Primeiros passos">
        <HelpModule title="Acesso e workspace privado">
          <p>Entre com o e-mail e a senha da conta autorizada. O sistema não oferece cadastro público de novas contas.</p>
          <ul>
            <li>Com o Supabase conectado, corridas e arquivos enviados ficam associados à sua conta.</li>
            <li>Sem conexão configurada, os rascunhos ficam apenas neste navegador e os arquivos não são enviados.</li>
            <li>Não compartilhe sua senha.</li>
          </ul>
        </HelpModule>
        <HelpModule title="Visão geral">
          <p>A página inicial resume suas corridas, a quantidade de fotos e o limite de fotos completas por rajada.</p>
          <ol>
            <li>Use <strong>Nova corrida</strong> para cadastrar e enviar fotos.</li>
            <li>Abra <strong>Minhas corridas</strong> para consultar registros anteriores.</li>
            <li>Use <strong>Organizar rajadas</strong> para separar fotos localmente e baixar um ZIP.</li>
          </ol>
        </HelpModule>
      </HelpGroup>

      <HelpGroup title="Corridas e fotografias">
        <HelpModule title="Cadastrar uma corrida e enviar fotos">
          <ol>
            <li>Informe o nome, a data e, se quiser, observações como cidade ou percurso.</li>
            <li>Selecione uma pasta, escolha arquivos ou arraste as imagens para a área indicada.</li>
            <li>O cadastro na nuvem aceita JPG, PNG e WEBP de até 50 MB por arquivo. Arquivos incompatíveis são ignorados.</li>
            <li>Defina o intervalo máximo da rajada em segundos. O valor sugerido é 2 segundos; ajuste de acordo com a câmera e a sequência.</li>
            <li>Clique em <strong>Analisar e preparar envio</strong>, confira as rajadas, fotos selecionadas, excedentes e itens para revisão.</li>
            <li>Depois, clique em <strong>Cadastrar e enviar</strong> e aguarde o progresso do envio.</li>
          </ol>
          <p>As fotos originais são preservadas, inclusive excedentes e imagens que precisam de revisão.</p>
        </HelpModule>
        <HelpModule title="Minhas corridas e galeria">
          <ul>
            <li>Em <strong>Minhas corridas</strong>, pesquise pelo nome e consulte o status e a quantidade de fotos.</li>
            <li>O botão <strong>Abrir</strong> em um cartão leva à galeria. Use o filtro de corrida para ver as fotos de uma corrida específica; também é possível pesquisar, navegar pelas páginas, selecionar imagens e marcar favoritas.</li>
            <li>Excluir uma corrida conectada remove também os arquivos dela do armazenamento privado. A ação pede confirmação e não pode ser desfeita.</li>
            <li>Se aparecer um aviso de envio parcial, leia o detalhe antes de repetir o cadastro para evitar registros duplicados.</li>
          </ul>
          <p>Os status indicam se a corrida está aguardando imagens, pronta, em processamento, concluída ou com erro.</p>
        </HelpModule>
        <HelpModule title="Armazenamento e dados locais">
          <ul>
            <li>A página <strong>Armazenamento</strong> mostra o estado da conexão, o uso do bucket e a quantidade de corridas.</li>
            <li>O Organizador de rajadas salva seleção e resultados no armazenamento local do navegador, separados por conta; isso não é enviado à nuvem nem sincronizado com outro computador.</li>
            <li>O tema visual também é salvo localmente. Limpar os dados do site no navegador apaga essa cópia local.</li>
            <li>Em <strong>Configurações</strong>, altere o tema e, quando estiver conectado à conta, o nome do perfil.</li>
          </ul>
        </HelpModule>
      </HelpGroup>

      <HelpGroup title="Organizador de rajadas">
        <HelpModule title="Selecionar fotos e iniciar o processamento">
          <ol>
            <li>Use <strong>Escolher pasta</strong>, <strong>Escolher imagens</strong> ou arraste as fotos para a área de seleção.</li>
            <li>O seletor de pastas pode não mostrar as fotos individualmente. Escolha a pasta desejada e confirme; use <strong>Escolher imagens</strong> para selecionar arquivos um a um.</li>
            <li>Confira o contador e o tamanho total. Selecione imagens aceitas pelo navegador, como JPG, JPEG, TIFF, PNG ou WEBP.</li>
            <li>Informe um intervalo máximo maior que zero e clique em <strong>Processar fotos</strong>. O app lê os metadados EXIF e agrupa por câmera e horário.</li>
            <li>Mantenha a página aberta enquanto a análise, o salvamento local e a geração do ZIP estiverem em andamento.</li>
          </ol>
          <p>O processamento acontece no navegador. As fotos não são enviadas ao Supabase pelo Organizador de rajadas.</p>
        </HelpModule>
        <HelpModule title="Entender os resultados">
          <ul>
            <li><strong>Fotos recebidas:</strong> imagens aceitas na seleção.</li>
            <li><strong>Rajadas identificadas:</strong> grupos formados a partir da câmera e do horário EXIF, considerando o intervalo definido.</li>
            <li><strong>Fotos completas:</strong> até 10 fotos mantidas em cada rajada.</li>
            <li><strong>Rajadas excedentes:</strong> número de grupos que ultrapassaram o limite de 10 fotos.</li>
            <li><strong>Fotos excedentes:</strong> total de imagens acima do limite; elas são preservadas separadamente.</li>
            <li><strong>Fotos para revisão:</strong> originais sem data válida, com metadados inválidos ou sequência ambígua.</li>
          </ul>
          <p>Fotos para revisão não são apagadas. O ZIP inclui as fotos completas, excedentes, itens para revisão e um relatório.</p>
        </HelpModule>
        <HelpModule title="Salvar e baixar o ZIP">
          <ul>
            <li>O salvamento automático, quando disponível, guarda os dados no navegador. Espere a barra de salvamento terminar antes de processar.</li>
            <li>Se a seleção for grande demais para o armazenamento local, o app usa modo temporário: não feche nem atualize a página antes de concluir o ZIP.</li>
            <li>Chrome e Edge atualizados podem abrir uma janela do sistema para escolher onde salvar.</li>
            <li>No Safari 26 ou mais recente, o ZIP é preparado temporariamente no armazenamento do site. Clique em <strong>Baixar para o Finder</strong>; o Safari usa o local de download configurado nos Ajustes e exige espaço livre adicional.</li>
            <li>Depois de confirmar que o download terminou, use <strong>Liberar espaço temporário</strong> para apagar a cópia intermediária.</li>
          </ul>
        </HelpModule>
      </HelpGroup>

      <HelpGroup title="Problemas comuns e soluções">
        <HelpModule title="A pasta parece vazia ou o contador continua em zero">
          <ul>
            <li>Na janela do sistema, selecione a pasta e confirme, mesmo que a lista de fotos pareça vazia.</li>
            <li>Para escolher arquivos individuais, use <strong>Escolher imagens</strong>, não o seletor de pastas.</li>
            <li>Confira se os formatos são aceitos e se a seleção foi confirmada. Se continuar em zero, tente arrastar algumas imagens para a área.</li>
          </ul>
        </HelpModule>
        <HelpModule title="Uma foto foi ignorada ou não pode ser enviada">
          <p>O cadastro de corridas aceita JPG, PNG e WEBP até 50 MB por arquivo. Formatos diferentes, arquivos vazios ou acima do limite são ignorados; selecione uma versão compatível e tente novamente.</p>
        </HelpModule>
        <HelpModule title="O salvamento local falhou ou não há espaço">
          <ul>
            <li>Espere a verificação ou o salvamento atual terminar. Se aparecer <strong>Tentar novamente</strong>, use-o para repetir o salvamento.</li>
            <li>Libere espaço no dispositivo e evite limpar os dados do site enquanto houver arquivos que ainda não foram exportados.</li>
            <li>Para seleção grande em modo temporário, mantenha a aba aberta até baixar o ZIP.</li>
          </ul>
        </HelpModule>
        <HelpModule title="O ZIP não baixa no Safari ou o download é bloqueado">
          <ul>
            <li>Use Safari 26 ou mais recente em uma aba normal, não em janela privada ou prévia incorporada.</li>
            <li>Confira se há espaço livre suficiente para uma cópia temporária do ZIP e para o download final.</li>
            <li>Após gerar o arquivo, clique em <strong>Baixar para o Finder</strong>. O destino depende da configuração de downloads do Safari.</li>
            <li>Em versões antigas do Safari, atualize o navegador ou use Chrome ou Edge atualizados.</li>
          </ul>
        </HelpModule>
        <HelpModule title="Há fotos para revisão ou uma rajada está excedente">
          <p>Isso não significa que os originais foram perdidos. Fotos sem data de captura, com EXIF inválido ou sequência ambígua ficam em revisão; fotos acima de 10 por rajada ficam como excedentes. Ambos os grupos são mantidos no ZIP para conferência.</p>
        </HelpModule>
        <HelpModule title="O upload apresentou erro ou ficou parcial">
          <p>Leia o aviso exibido em <strong>Minhas corridas</strong>, confira a conexão e o limite de tamanho por arquivo. Se o erro continuar, guarde a mensagem exibida e procure o responsável pela conta antes de repetir o cadastro.</p>
        </HelpModule>
      </HelpGroup>
    </div>
  )
}
