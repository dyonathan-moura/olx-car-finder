## PRD — OLX Car Finder (Web + Extensão) — MVP (uso pessoal)

### 0) Visão

Criar um produto que transforma uma busca da OLX (já filtrada pelo usuário) em um “monitor” inteligente:

* reduz o caos da lista grande com **segmentação por modelo**
* **alerta** quando entram anúncios novos que batem na busca

**Plataforma:** Web (dashboard) + Extensão (Chrome/Brave MV3)
**Fonte de dados:** JSON do front da OLX (`/_next/data/...json`)
**Chave do anúncio:** `list_id` (confirmado)

---

## 1) Problema

Mesmo usando os filtros da OLX (preço, km, ano, região etc.), o resultado ainda é grande demais. O usuário quer:

1. salvar a busca
2. ser notificado quando entrar anúncio novo
3. primeiro decidir por **modelos** (ex.: Fit, Onix) antes de ler centenas de anúncios

---

## 2) Objetivos do MVP

* **Salvar busca** baseada na URL atual da OLX (sem reinventar filtro)
* **Monitorar** novos anúncios via JSON (sem scraping HTML)
* **Segmentar por modelo** (mínimo: por título; ideal: por campo estruturado no JSON)
* **Notificar** novos anúncios (com controle por modelo)

### Não-objetivos (MVP)

* Não usar FIPE / IA / recomendação complexa
* Não integrar OLX chat/favoritos/perfil (`/me`, etc.)
* Não varrer todas as páginas (limite intencional)
* Não multi-marketplace (só OLX)

---

## 3) Personas

* **Usuário único (pessoal):** quer encontrar carro diferenciado em condições específicas, sem ficar abrindo OLX toda hora.

---

## 4) Escopo funcional (MVP)

### 4.1 Extensão — “Salvar busca”

**User story:**
Como usuário, quero salvar a busca que estou vendo na OLX para monitorar depois.

**Fluxo:**

1. Usuário abre uma busca na OLX com filtros aplicados
2. Clica no ícone da extensão → “Salvar esta busca”
3. Informa nome (ex.: “RS 20–35k, 20–100k km, ≥2014”)
4. Seleciona frequência (default 60 min)
5. Busca aparece no Dashboard

**Dados salvos:**

* `name`
* `human_url` (URL da OLX)
* `check_period_minutes`

---

### 4.2 Extensão — “Checagem periódica e novos anúncios”

**User story:**
Como usuário, quero ser notificado quando aparecer um anúncio novo que bate na minha busca.

**Como funciona:**

* Extensão roda a cada X minutos (chrome.alarms).
* Para cada busca salva:

  * consulta o endpoint JSON do Next.js do front da OLX (`/_next/data/...json`)
  * pagina por `sp=1..N` (N limitado)
  * coleta `list_id` + campos básicos
* “Novo anúncio” = `list_id` não visto anteriormente para aquela busca.

**Paginação:**

* `sp` é “página” (confirmado por você)
* Cada `sp` retorna lista diferente
* Limite do MVP: **até 5 páginas por execução**

**Critério de parada:**

* `ads` vazio **ou**
* repetição de `first_list_id` (loop/cache) **ou**
* atingiu limite (5 páginas)

---

### 4.3 Dashboard Web — “Segmentação por modelo”

**User story:**
Como usuário, quero ver a lista agrupada por modelo para decidir rapidamente o que me interessa.

**Dashboard mostra por busca:**

* Resumo: total coletado na última rodada, novos anúncios, última checagem
* **Modelos detectados** (modelo → contagem)
* Lista de “Novos anúncios” (com filtro por modelo)

**Modelo (extração):**

* Primário: campo estruturado no JSON (se existir, ex.: `vehicle_model` dentro de properties)
* Fallback: heurística do `subject` (primeira(s) palavras relevantes)
* O usuário pode:

  * **whitelist** de modelos (monitorar só esses)
  * **blacklist** (silenciar ruídos)

---

### 4.4 Notificações (browser)

**Conteúdo do alerta:**

* título (subject)
* preço
* município/bairro (se existir)
* botão “Abrir anúncio”
* ação “Silenciar modelo” (se modelo detectado)

**Anti-spam:**

* agrupar notificações por busca (ex.: “3 novos anúncios — Fit (1), Onix (2)”)

---

## 5) Requisitos não funcionais

* **Uso pessoal, baixo volume:** limite de páginas e frequência default 60 min.
* **Resiliência:** se endpoint mudar, não “quebra tudo”: fallback para “apenas salvar busca + abrir link” (sem monitoramento) ou fallback mínimo por HTML (opcional no MVP; recomendado na v1).
* **Privacidade:** armazenar localmente por padrão (sem backend).

---

## 6) Modelo de dados (local-only)

**SavedSearch**

* `id`
* `name`
* `human_url`
* `check_period_minutes`
* `model_whitelist[]`
* `model_blacklist[]`
* `last_checked_at`
* `seen_ids` (set/array com cap, ex.: 2000)

**Listing (snapshot mínimo)**

* `list_id`
* `ad_url`
* `subject`
* `price`
* `municipality`
* `neighbourhood`
* `date_ts` (se existir)
* `model` (derivado)

**Alert**

* `search_id`
* `list_id`
* `created_at`
* `status` (new/opened/muted)

---

## 7) Critérios de aceite (testáveis)

### Salvar busca

* Dado que estou numa busca da OLX, ao clicar “Salvar”, ela aparece no dashboard com nome e URL.

### Paginação por JSON

* Para uma busca salva, a extensão consulta `sp=1..5` e coleta listas diferentes (IDs distintos) por página.

### Detecção de novos anúncios

* Se um `list_id` aparece e não estava em `seen_ids`, ele gera alerta **uma vez**.

### Segmentação por modelo

* Dashboard lista “Modelos detectados” com contagem e permite whitelist/blacklist.
* Com whitelist ativa, só gera alerta para anúncios cujo `model` está na lista.

### Robustez mínima

* Se uma checagem falhar, a extensão não perde dados existentes e tenta de novo na próxima rodada.

---

## 8) UX / Telas

### Extensão (popup)

1. Botão: **Salvar busca atual**
2. Nome da busca (input)
3. Frequência (dropdown: 30/60/180 min)
4. Link “Abrir Dashboard”
5. Lista resumida de buscas + status (última checagem, novos)

### Dashboard Web

**Tela 1 — Lista de buscas**

* card por busca: nome, última checagem, novos
* ações: editar nome, editar frequência, remover
* abrir busca no OLX

**Tela 2 — Detalhe da busca**

* modelos (tabela)
* toggle whitelist/blacklist
* novos anúncios (lista)

---

## 9) Plano de entrega (2 sprints)

### Sprint 1 (MVP funcional)

* Salvar busca
* Agendar checagens
* Consumir JSON do `_next/data`
* Paginar com `sp`
* Detectar novos anúncios e notificar
* Dashboard simples: lista de buscas + novos anúncios

### Sprint 2 (Diferencial)

* Modelo detectado (properties → fallback subject)
* Agrupamento por modelo + whitelist/blacklist
* “Silenciar modelo” na notificação
* Anti-spam (agrupar notificações)

---

## 10) Riscos e mitigação

* **BuildId muda** no `_next/data`: solução = derivar dinamicamente a URL de dados por rodada (não hardcode).
* **Endpoints internos mudam**: mitigação = fallback mínimo e logs de debug.
* **Bloqueio/Cloudflare:** uso pessoal + baixa frequência + execução no navegador do usuário.

---

## 11) Decisões abertas (marcar agora)

1. **Local-only ou conta?**
   Recomendação: **local-only no MVP**.
2. **Limite default de páginas:** 3 ou 5?
   Recomendação: **5** (uso pessoal, melhora recall).

Se você confirmar essas 2 decisões, eu fecho também um **backlog em formato de tarefas** (Kanban) com critérios por card (para você executar/terceirizar).


Backlog — OLX Car Finder (Web + Extensão) — MVP
EPIC 1 — Fundação (Storage + Modelo)

1.1 — Definir modelo local de dados (SavedSearch / Seen / Alerts)

Descrição: Estruturar o schema local (no storage da extensão) para buscas, estado de varredura e alertas.

Campos mínimos:

SavedSearch: id, name, human_url, check_period_minutes, created_at, last_checked_at

Estado de scan: last_sp_scanned, scan_cursor_mode (fast+progressive), seen_ids (cap)

Preferências: model_whitelist, model_blacklist

Alerts: search_id, list_id, created_at, status

Aceite: criar/atualizar/remover SavedSearch sem perda de dados; seen_ids respeita cap (ex.: mantém últimos 2000).

1.2 — Política de cap e deduplicação de seen_ids

Descrição: Evitar crescimento infinito (memória).

Regra: manter set por busca com cap (ex.: 2000). Ao ultrapassar, remover mais antigos.

Aceite: simular inserção de 2500 IDs → storage mantém 2000; IDs antigos são descartados.

EPIC 2 — Captura de Busca (UI extensão)

2.1 — Popup: “Salvar busca atual”

Descrição: botão no popup que salva a URL atual + nome + frequência.

Aceite: estando em uma aba da OLX, ao salvar:

cria registro com human_url idêntica à barra

aparece na lista de buscas salvas no popup

2.2 — Edição básica no popup

Descrição: renomear busca e ajustar frequência.

Aceite: alterações persistem após fechar/abrir navegador.

EPIC 3 — Motor de Coleta (JSON Next.js)

3.1 — Resolver URL de dados (_next/data) a partir da busca

Descrição: dado human_url, montar a requisição _next/data/<buildId>/...json + query com filtros.

Regra: buildId não é fixo → precisa ser obtido dinamicamente.

Aceite: para uma busca salva, o motor consegue obter JSON não vazio e encontrar o array de anúncios com list_id e ad_url.

3.2 — Parser de anúncios (normalização)

Descrição: extrair de cada item:

list_id, ad_url, subject, price, municipality, neighbourhood, date_ts (se houver)

Aceite: retorna uma lista apenas com anúncios “válidos” (tem list_id e ad_url).

3.3 — Paginação por sp (fast_top_only)

Descrição: varrer sp=1..5 sempre.

Aceite: em uma execução:

consulta sp 1..5

obtém IDs diferentes por página (não precisa comparar todos, mas ao menos prova por amostra)

gera conjunto current_top_ids

3.4 — Paginação progressiva (progressive_full)

Descrição: continuar varrendo a partir de last_sp_scanned (inicialmente 6), avançando sp+1.

Stop conditions:

retorno sem anúncios válidos → acabou (reset opcional do cursor)

loop/cache detectado (first_list_id repetiu) → parar e tentar depois

budget estourou (tempo ou requests) → parar e salvar last_sp_scanned

Aceite: após 3 execuções consecutivas, last_sp_scanned avança (ex.: 6→16→26) e retoma corretamente.

3.5 — Budget por rodada (guardrail obrigatório)

Descrição: limitar custo por execução sem “limite de páginas”:

budget_seconds (ex.: 60s) ou budget_requests (ex.: 30)

Aceite: em execução com muitas páginas, o motor para por budget e salva checkpoint.

EPIC 4 — Detecção de Novos & Alertas

4.1 — Diff engine (novos anúncios)

Descrição: new_ids = current_ids - seen_ids (onde current_ids = top + progressivo da rodada).

Aceite: inserir manualmente 10 IDs em seen_ids, retornar lista com 3 IDs novos → diff retorna exatamente 3.

4.2 — Criar alertas e atualizar seen_ids

Descrição: para cada new_id, criar registro de alerta; atualizar seen_ids.

Aceite: um list_id só gera alerta 1 vez, mesmo reaparecendo depois.

4.3 — Anti-spam: agrupar notificações por busca

Descrição: se new_ids > 1, gerar uma notificação consolidada.

Aceite: quando entram 5 novos, aparece 1 notificação com contagem e resumo.

EPIC 5 — Notificações e Ações

5.1 — Notificação com “Abrir anúncio”

Descrição: notificação traz link do anúncio.

Aceite: clicar abre a página do anúncio em nova aba.

5.2 — Ação “Silenciar modelo” (Sprint 2)

Descrição: quando modelo estiver disponível, permitir inserir em blacklist a partir do alerta.

Aceite: após silenciar, anúncios daquele modelo não disparam alerta.

EPIC 6 — Dashboard Web (local-only)

Opção simples: dashboard como página interna da extensão (mais fácil para local-only).
Se for “web fora”, precisa ponte (export/import) — não recomendo no MVP.

6.1 — Página “Minhas buscas”

Descrição: listar SavedSearch com:

nome, frequência, última checagem, novos (última rodada)

Aceite: lista reflete exatamente o storage local.

6.2 — Detalhe da busca

Descrição: mostrar:

últimos alertas

botão “Abrir busca na OLX”

status do scan (last_sp_scanned)

Aceite: ao abrir detalhe, vê alertas e consegue abrir OLX.

EPIC 7 — Modelos (Segmentação) — Sprint 2

7.1 — Extração de modelo

Descrição: prioridade:

campo estruturado do JSON (se existir)

fallback heurístico pelo subject

Aceite: pelo menos 70% dos anúncios no topo recebem um modelo não vazio (medida simples em amostra).

7.2 — Agrupamento por modelo no detalhe da busca

Descrição: tabela “Modelo → contagem → mediana preço (opcional)”.

Aceite: modelos aparecem ordenados por contagem.

7.3 — Whitelist/Blacklist

Descrição: usuário seleciona modelos para acompanhar; alertas respeitam.

Aceite: whitelist ativa → anúncios fora dela não alertam.

Ordem de execução recomendada (pra você não se perder)

EPIC 1 (storage)

EPIC 2 (salvar busca)

EPIC 3.2 + 3.3 (JSON + sp 1..5)

EPIC 4 (diff + alertas)

EPIC 5.1 (notificação abrir anúncio)

EPIC 3.4 + 3.5 (progressivo + budget)

EPIC 6 (dashboard simples)

EPIC 7 (modelos + whitelist)
