# OLX Car Finder — Runbook de Operação

Documento para operação diária e troubleshooting do monitor de anúncios.

## 1. Monitoramento de Saúde

### Verificar se está rodando
O Workers roda via cron trigger a cada 30 min.
- **Console Cloudflare**: Vá em `Workers & Pages` > `olx-car-finder` > `Logs`.
- **Banco de Dados**: Consulte a tabela `execution_logs` no D1.
  ```sql
  SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 10;
  ```
  Verifique se `status = 'completed'` e `new_listings_count` faz sentido.

### Métricas Chave
- **Taxa de Erro**: Se muitos `status = 'error'`, verifique `error_message`.
- **Duração**: Se `duration_ms > 20000`, pode estar próximo do timeout (30s).
- **Loops**: Se `stop_reason = 'loop'`, o motor de diff detectou repetição. Isso geralmente se resolve sozinho na próxima execução, mas vale monitorar.

## 2. Troubleshooting Comum

### Erro: 404 / Invalid Build ID
O `buildId` do Next.js da OLX expirou.
- **Ação Automática**: O sistema tenta se curar (faz 1 retry baixando HTML novo).
- **Ação Manual**: Se persistir, o site da OLX pode ter mudado a estrutura. Verifique `src/services/olx-fetcher.ts`.

### Erro: Unauthorized (401)
API retornando erro de auth.
- **Extensão**: Verifique o token no armazenamento ou logs da extensão.
- **Worker**: Verifique a variavel de ambiente `API_TOKEN` no Cloudflare dashboard.

### Anúncios não aparecem
- Verifique se a busca salva tem resultados na OLX real.
- Verifique os filtros de "Ignorados" (Marca/Modelo/Ano).
- Verifique "Grupos Confiáveis" (Trusted Groups): Se ativado, modelos raros (menos de 5 anúncios) são ocultados se não tiverem histórico suficiente para mediana. Desative o filtro "Confiável" no dashboard.

## 3. Comandos Úteis

### Forçar Scan Manual (API)
```bash
curl -X POST https://seu-worker.workers.dev/api/scan \
  -H "X-Access-Token: SEU_TOKEN"
```

### Consultar Logs de Execução
```bash
npx wrangler d1 execute olx-car-finder-db --command "SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 5" --remote
```

### Limpar Tabela de Alertas (Reset)
**Cuidado**: Apaga histórico.
```bash
npx wrangler d1 execute olx-car-finder-db --command "DELETE FROM alerts" --remote
```

## 4. Configuração

### Adicionar Token de API
1. No Cloudflare Dashboard: `Settings` > `Variables` > `API_TOKEN`.
2. Na Extensão: (Futuro) Página de opções. Atualmente via código ou `chrome.storage.sync`.
