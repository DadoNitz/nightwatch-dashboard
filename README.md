# NIGHTWATCH 3

Central local para um terceiro monitor com telemetria de CPU/GPU, temperatura e hotspot, ventoinhas, discos, rede em tempo real, notícias de tecnologia e o agente pessoal JARVIS.

## Requisitos

- Windows 10 ou 11.
- Node.js 18+ e npm.
- .NET 8+ para a ponte de sensores.
- Driver NVIDIA com `nvidia-smi` para GPUs NVIDIA.
- FanControl para RPM, curvas e sensores térmicos avançados.
- Wireshark com Npcap/TShark somente para a captura opcional de pacotes.

## Instalação

Execute `Install-NIGHTWATCH.ps1`. O instalador prepara as dependências, compila a ponte de sensores, cria o atalho NIGHTWATCH e configura inicialização automática com watchdog.

Depois, abra `NIGHTWATCH.lnk`. O painel inicia em tela cheia no monitor não principal mais à direita. Use `F11` ou `Alt+F4` para sair.

## Painel operacional

- `O`: abre a OPS CONSOLE.
- `F`: abre o painel de ventoinhas e sensores.
- `R`: força uma atualização.
- Perfis `QUIET`, `NORMAL`, `GAMING` e `ALERT` ajustam limites e aparência.
- O seletor de interface usa apenas adaptadores físicos ativos; Radmin VPN, túneis e adaptadores virtuais são ignorados automaticamente.
- Rede mostra download/upload reais, interface, ping médio, jitter, perda, conexões e processos.
- O hotspot aparece ao lado da temperatura da GPU como `HS 70°C Δ18°`. `HS N/D` significa que o driver ou FanControl não expôs esse sensor.
- Alertas podem gerar notificações do Windows após autorização do usuário.
- A captura TShark é limitada a 60 segundos e 1000 pacotes.

O tráfego exibido é o uso instantâneo do PC, não a velocidade máxima contratada. Um speedtest contínuo consumiria banda desnecessariamente.

## JARVIS

Abra [http://127.0.0.1:4280/jarvis](http://127.0.0.1:4280/jarvis).

O JARVIS oferece:

- Conversa persistente no estilo ChatGPT.
- Respostas faladas desligadas por padrão.
- Botão `OUVIR` em cada resposta e chave global `VOZ ON/OFF`.
- Microfone para ditado por push-to-talk.
- Telemetria ao vivo do PC.
- Abertura de aplicativos permitidos.
- Lembretes locais com notificações.
- Gmail e Google Calendar por OAuth.
- Criação de eventos somente após confirmação explícita.

Para conectar a inteligência OpenAI, execute `Configurar-JARVIS.ps1` e reinicie o NIGHTWATCH. A chave é armazenada nas variáveis do usuário do Windows e nunca deve ser enviada ao Git. Também é possível copiar `.env.example` para `.env.local`, mas esse arquivo contém segredos e é ignorado pelo repositório.

Para Gmail e Calendar, configure um cliente OAuth do Google e informe `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` pelo mesmo configurador. O JARVIS recebe tokens OAuth; ele não recebe sua senha do Google.

## iPhone

Execute `Ativar-JARVIS-iPhone.ps1`. O script:

- libera a porta 4280 somente para a sub-rede privada local;
- reinicia o servidor em modo LAN;
- encontra o endereço IPv4 físico, ignorando Radmin/VPN;
- copia o endereço do JARVIS e mostra o código de pareamento no PC.

Abra o endereço exibido no Safari e informe o código de seis dígitos. Para instalação PWA completa, microfone e notificações no iPhone, publique o endereço por HTTPS em uma rede ou túnel privado; o iOS restringe esses recursos em HTTP comum.

## Segurança e privacidade

- Dados de telemetria permanecem locais.
- Ações mutáveis exigem token fora do próprio PC.
- O acesso pelo iPhone usa pareamento de seis dígitos e token local.
- O firewall do modo iPhone aceita somente a sub-rede privada.
- Captura de rede, Gmail, Calendar e OpenAI são opcionais.
- O painel nunca controla diretamente os headers da placa-mãe; ajustes físicos continuam no FanControl.

Arquivos locais como histórico, preferências, tokens, capturas e `.env.local` são ignorados pelo Git.

## APIs principais

- `/api/stats`: telemetria atual, rede, alertas e histórico curto.
- `/api/history?hours=24`: histórico persistente.
- `/api/hardware`: sensores e ventoinhas.
- `/api/network/advanced`: conexões agrupadas por processo.
- `/api/disks`: saúde dos discos.
- `/api/diagnostics`: dependências e integrações locais.
- `/api/agent/status`: estado e capacidades do JARVIS.
