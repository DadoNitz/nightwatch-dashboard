# PC Pulse

## Requisitos

- Windows 10/11
- Node.js 18+ e npm
- .NET 8 SDK (a ponte de sensores é compilada automaticamente na primeira execução)
- FanControl instalado para temperatura/RPM e controle térmico
- Driver NVIDIA com `nvidia-smi` para telemetria da GPU NVIDIA

## NIGHTWATCH // console operacional

- `O` abre a OPS CONSOLE com latencia, perda de pacotes, interface ativa, top de processos e alertas.
- `F` abre o controle termico e `R` forca uma atualizacao.
- A interface de rede e escolhida entre adaptadores fisicos ativos; Radmin VPN, loopback e tuneis sao ignorados. Se houver mais de uma, use o seletor da OPS CONSOLE.
- Os perfis `QUIET`, `NORMAL`, `GAMING` e `ALERT` ajustam limites e tema; as curvas fisicas continuam sob controle do FanControl.
- O perfil escolhido e salvo localmente em `nightwatch.settings.json`.
- Reabra o atalho NIGHTWATCH na barra de tarefas para aplicar uma nova versao do servidor.
- O atalho usa o ícone personalizado `nightwatch.ico`, também instalado na inicialização do Windows.

Painel local para um monitor dedicado, com CPU, GPU NVIDIA, RAM, discos e tráfego de rede em tempo real.

## Como abrir

Dê dois cliques em **INICIAR-PAINEL.cmd**. Na primeira execução, a instalação do pequeno módulo de telemetria pode levar alguns segundos. O painel abre em tela cheia no monitor não principal mais à direita.

Para sair da tela cheia, pressione **F11** ou **Alt+F4**.

## Observações

- A leitura de GPU usa o driver NVIDIA instalado.
- Temperatura da CPU aparece quando o firmware/driver a expõe ao Windows; caso contrário, mostra `N/D`.
- O medidor de rede é tráfego real instantâneo do computador, não a capacidade máxima da internet. Um speedtest contínuo consumiria muita banda.
- **Network Intel** mostra conexões TCP ativas, IP e porta remotos, processo responsável, conexões externas e portas em escuta. Atualiza a cada 5 segundos e não precisa de administrador.
- **Tech Intelligence** reúne notícias recentes de TecMundo, Tecnoblog, Canaltech e Olhar Digital, com atualização automática a cada 15 minutos e ticker contínuo no rodapé.
- **Thermal Control** é um acordeão no canto inferior esquerdo. Ele lê temperatura da CPU, RPM, modo e percentual diretamente da API local do FanControl. Como o FanControl roda elevado, o NIGHTWATCH solicitará administrador ao iniciar.
- Para preservar a bomba e as curvas calibradas, o painel não escreve diretamente nos headers da placa-mãe. Use o botão **Abrir FanControl para ajustar** dentro do acordeão.
- O painel não captura o conteúdo dos pacotes. Captura completa no estilo Wireshark exige instalar Npcap/TShark e executar o capturador com privilégios apropriados.
- Tudo roda localmente em `127.0.0.1:4280`; nenhum dado é enviado para fora.
