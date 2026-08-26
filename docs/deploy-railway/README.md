# Instalar no Railway

**Estado: implementado no repositório; publicação do template depende de uma release e de um
ensaio real no Railway.** Não há um botão público anunciado enquanto essa prova não existir.

No Railway, a instalação não roda `hostgator-setup-kit/install.sh`. O equivalente é o arquivo
versionado [`.railway/railway.ts`](../../.railway/railway.ts), que provisiona cada processo como
serviço e usa rede privada entre eles.

| Na VPS | No Railway |
|---|---|
| Docker Compose | Railway IaC |
| Caddy/Traefik | domínio e TLS do Railway |
| cron dentro do scheduler | serviço Scheduler persistente |
| volumes Docker do WAHA | dois volumes Railway |
| Redis + Redis REST | Redis gerenciado + RedisRest |
| aplicação manual do baseline | serviço Inicialização one-shot |
| `update.sh` | troca coordenada dos quatro pins de imagem |

O WAHA cabe nessa topologia e não exige uma VPS própria. A restrição importante é manter
**uma réplica**, persistir `/app/.sessions` e `/app/.media` e não expor seu painel à internet.
Se a operação exigir acesso ao host, backup por arquivo, proxy customizado ou custos mais
previsíveis, a VPS continua sendo o caminho mais flexível.

O passo a passo operacional, a lista de variáveis e os comandos `config plan`, `config apply`
e `templates create` estão em [`.railway/README.md`](../../.railway/README.md).
