# TP Jour 4 : Alerting et monitoring complet

> **Durée** : ~2h45 (puis QCM 45 min) | **Objectif** : Compléter la stack avec cAdvisor, blackbox_exporter et Alertmanager ; écrire des règles d'alerte sur les symptômes, les valider dans le CI (`promtool`, `amtool`), router les alertes vers MailHog et Discord, poser un silence, et faire poser une **annotation Grafana** à chaque déploiement.

---

## Prérequis

- TP3 terminé : stack `monitoring/` fonctionnelle, 6 targets UP, dashboard *TaskFlow RED*
- Un webhook Discord (*Paramètres du salon → Intégrations → Webhooks*) ou Slack ; à défaut, MailHog suffira
- `amtool`/`promtool` : inutile de les installer, on les exécute dans les conteneurs

---

## Étape 1 : Surveillance infra et disponibilité externe (30 min)

### 1.1 Compléter le compose

Dans `monitoring/docker-compose.yml`, décommentez / ajoutez :

```yaml
  alertmanager:
    image: prom/alertmanager:v0.27.0
    container_name: alertmanager
    ports: ["9093:9093"]
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - alertmanager-data:/alertmanager
    command:
      - --config.file=/etc/alertmanager/alertmanager.yml
      - --storage.path=/alertmanager
    networks: [monitoring]

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    container_name: cadvisor
    ports: ["8081:8080"]
    privileged: true
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    networks: [monitoring]

  blackbox-exporter:
    image: prom/blackbox-exporter:v0.25.0
    container_name: blackbox-exporter
    ports: ["9115:9115"]
    volumes:
      - ./blackbox/blackbox.yml:/etc/blackbox_exporter/config.yml:ro
    networks: [monitoring]

  mailhog:
    image: mailhog/mailhog:v1.0.1
    container_name: mailhog
    ports: ["8025:8025", "1025:1025"]
    networks: [monitoring]
```

et dans `volumes:` : `alertmanager-data:`.

`monitoring/blackbox/blackbox.yml` (fourni) :

```yaml
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      valid_status_codes: [200]
      method: GET
```

### 1.2 Les jobs Prometheus

Ajoutez à `prometheus.yml` :

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

scrape_configs:
  # … jobs existants …

  - job_name: cadvisor
    static_configs:
      - targets: ['cadvisor:8080']

  # Boîte noire : Prometheus demande à blackbox de sonder chaque URL
  - job_name: blackbox
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - http://192.168.64.11/health
          - http://192.168.64.12/health
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target        # l'URL devient le paramètre ?target=
      - source_labels: [__param_target]
        target_label: instance               # …et le label instance
      - target_label: __address__
        replacement: blackbox-exporter:9115  # c'est blackbox qu'on scrape réellement
      - source_labels: [__param_target]
        regex: 'http://192\.168\.64\.11.*'
        target_label: env
        replacement: staging
      - source_labels: [__param_target]
        regex: 'http://192\.168\.64\.12.*'
        target_label: env
        replacement: prod
```

```bash
cd ~/taskflow-ops/monitoring
docker compose up -d
docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml
curl -X POST http://localhost:9090/-/reload
```

**Résultat attendu :** 10 targets UP (les 6 précédentes + cadvisor + 2 blackbox + alertmanager n'est pas scrapé mais visible dans *Status → Runtime & Build → Alertmanagers*). Requêtes :

- `probe_success` → `1` pour les deux URL ; `probe_duration_seconds` → quelques ms
- `sum(rate(container_cpu_usage_seconds_total{name=~".+"}[5m])) by (name)` → CPU par conteneur de votre poste
- `predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[1h], 4*3600)` → octets libres prévus dans 4 h

### 1.3 Panels infra dans Grafana

Ajoutez au dashboard *TaskFlow RED* une ligne « Infra » : disponibilité (`probe_success`, type *Stat*, mapping 1 → UP vert / 0 → DOWN rouge), CPU VM (requête 7 du TP3), disque prévu à 4 h. Ré-exportez le JSON.

---

## Étape 2 : Règles d'alerte, validées par le CI (45 min)

### 2.1 `rules/taskflow.yml`

```yaml
groups:
  - name: taskflow.rules
    rules:
      # Recording rules : pré-calculent les expressions utilisées partout
      - record: job:http_requests:rate5m
        expr: sum(rate(http_requests_total[5m])) by (env)
      - record: job:http_errors:ratio5m
        expr: >
          sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (env)
          / sum(rate(http_requests_total[5m])) by (env)

  - name: taskflow.alerts
    rules:
      # Dead man's switch : toujours en firing ; si elle disparaît, c'est la chaîne d'alerte qui est morte
      - alert: Watchdog
        expr: vector(1)
        labels: { severity: none }
        annotations:
          summary: "Alerte permanente de bon fonctionnement du pipeline d'alerting"

      - alert: InstanceDown
        expr: up == 0
        for: 1m
        labels: { severity: warning }
        annotations:
          summary: "Target {{ $labels.job }} injoignable ({{ $labels.instance }})"
          description: "Prometheus ne parvient plus à scraper {{ $labels.instance }} depuis 1 min."
          runbook_url: https://github.com/<vous>/taskflow-ops/blob/main/docs/runbooks/instance-down.md

      - alert: TaskFlowApiDown
        expr: probe_success{job="blackbox"} == 0
        for: 1m
        labels: { severity: critical }
        annotations:
          summary: "TaskFlow {{ $labels.env }} ne répond plus"
          description: "La sonde HTTP {{ $labels.instance }} échoue depuis 1 min."
          runbook_url: https://github.com/<vous>/taskflow-ops/blob/main/docs/runbooks/api-down.md

      - alert: HighErrorRate
        expr: job:http_errors:ratio5m > 0.05
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "Taux d'erreur 5xx > 5 % sur {{ $labels.env }}"
          description: "{{ $value | humanizePercentage }} des requêtes échouent depuis 5 min."

      - alert: HighLatencyP95
        expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, env)) > 0.3
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "Latence p95 > 300 ms sur {{ $labels.env }}"
          description: "p95 = {{ $value | humanizeDuration }}"

      - alert: HostHighCpu
        expr: 100 - avg by (instance, env) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100 > 80
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "CPU > 80 % depuis 10 min sur {{ $labels.instance }}"

      - alert: DiskWillFillIn4h
        expr: predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}[1h], 4 * 3600) < 0
        for: 30m
        labels: { severity: warning }
        annotations:
          summary: "Disque {{ $labels.mountpoint }} plein dans < 4 h ({{ $labels.instance }})"
```

```bash
docker compose exec prometheus promtool check rules /etc/prometheus/rules/taskflow.yml
curl -X POST http://localhost:9090/-/reload
```

**Résultat attendu :** `SUCCESS: 9 rules found`. Dans Prometheus → **Alerts** : `Watchdog` est *Firing* (normal), les autres *Inactive*.

> **Symptômes d'abord.** `TaskFlowApiDown`, `HighErrorRate`, `HighLatencyP95` décrivent ce que **l'utilisateur** subit. `HostHighCpu` est une alerte de cause : utile pour le diagnostic, mais un CPU à 85 % qui sert correctement les requêtes ne justifie pas de réveiller quelqu'un. D'où `warning` et `for: 10m`.

### 2.2 Valider les règles dans le CI

Dans `ci.yml`, ajoutez un job (à côté de `front` et `api`) :

```yaml
  lint-monitoring:
    name: 📈 Lint monitoring
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: promtool check rules
        uses: docker://prom/prometheus:v2.53.0
        with:
          entrypoint: promtool
          args: check rules monitoring/prometheus/rules/taskflow.yml

      - name: promtool check config (syntaxe uniquement — les fichiers montés n'existent pas ici)
        uses: docker://prom/prometheus:v2.53.0
        with:
          entrypoint: promtool
          args: check config --syntax-only monitoring/prometheus/prometheus.yml

      - name: amtool check-config
        uses: docker://prom/alertmanager:v0.27.0
        with:
          entrypoint: amtool
          args: check-config monitoring/alertmanager/alertmanager.yml
```

Cassez volontairement une règle (par exemple `expr: up = 0`), poussez, constatez l'échec, corrigez.

**Résultat attendu :** `📈 Lint monitoring` rouge avec `parse error: unexpected "="` puis vert après correction. **La config de monitoring est du code : elle passe par le CI comme le reste.**

> `amtool check-config` a besoin d'un `alertmanager.yml` valide : créez-le à l'étape 3 avant de pousser, sinon le job échouera sur le squelette du starter.

---

## Étape 3 : Alertmanager, notifications, silence (45 min)

### 3.1 `alertmanager/alertmanager.yml`

```yaml
global:
  smtp_smarthost: mailhog:1025
  smtp_from: alertmanager@taskflow.local
  smtp_require_tls: false

route:
  receiver: mail                       # receveur par défaut
  group_by: ['alertname', 'env']       # 1 notification par (alerte, environnement)
  group_wait: 30s                      # attend 30 s pour grouper les alertes qui arrivent ensemble
  group_interval: 5m                   # nouvelles alertes dans un groupe existant : toutes les 5 min
  repeat_interval: 4h                  # rappel d'une alerte toujours active : toutes les 4 h
  routes:
    - matchers: ['severity="critical"']
      receiver: discord
      continue: true                   # ET on continue vers le receveur par défaut (mail)
    - matchers: ['alertname="Watchdog"']
      receiver: blackhole              # le Watchdog ne notifie personne ici (il servirait à un service externe)

receivers:
  - name: mail
    email_configs:
      - to: ops@taskflow.local
        send_resolved: true
  - name: discord
    discord_configs:
      - webhook_url: https://discord.com/api/webhooks/CHANGE_ME
        send_resolved: true
  # Alternative Slack :
  # - name: slack
  #   slack_configs:
  #     - api_url: https://hooks.slack.com/services/CHANGE_ME
  #       channel: '#alertes'
  #       send_resolved: true
  - name: blackhole

inhibit_rules:
  # Si une alerte critical est active, on tait les warning de la même cible
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="warning"']
    equal: ['env', 'instance']
```

Remplacez `CHANGE_ME` par votre webhook Discord (ce fichier contient alors un secret : voir l'encadré).

```bash
docker compose exec alertmanager amtool check-config /etc/alertmanager/alertmanager.yml
docker compose restart alertmanager
```

**Résultat attendu :** `SUCCESS  Found: - global config - route - 2 inhibit rules - 3 receivers`. http://localhost:9093 affiche `Watchdog` dans l'onglet *Alerts*.

> **Un webhook est un secret.** Ne committez pas `alertmanager.yml` avec la vraie URL : copiez-le en `alertmanager.yml` (gitignoré) depuis un `alertmanager.example.yml` committé, ou utilisez `webhook_url_file` pointant vers un fichier gitignoré. Le job CI valide alors l'`example`.

### 3.2 Déclencher une vraie alerte

```bash
multipass exec taskflow-web1 -- sudo systemctl stop taskflow-api
```

Suivez la chaîne (comptez ~2 min) :

1. Prometheus → *Alerts* : `TaskFlowApiDown{env="staging"}` passe **Pending** (jaune) puis **Firing** (rouge) après `for: 1m` ; `InstanceDown` sur `taskflow-api` aussi
2. Alertmanager (:9093) : l'alerte apparaît, groupée par `alertname, env`
3. MailHog (http://localhost:8025) : un mail `[FIRING:1] TaskFlowApiDown staging` après `group_wait` — et **pas** de mail `InstanceDown` : inhibé par la critical (`inhibit_rules`)
4. Discord : le message du webhook, avec `summary`, `description`, lien *runbook*

```bash
multipass exec taskflow-web1 -- sudo systemctl start taskflow-api
```

**Résultat attendu :** ~1 min plus tard, mail et message `[RESOLVED]`.

### 3.3 Poser un silence (maintenance)

Vous allez redémarrer staging pour une maintenance : personne ne doit être notifié.

```bash
docker compose exec alertmanager amtool silence add \
  alertname=TaskFlowApiDown env=staging \
  --alertmanager.url=http://localhost:9093 -d 1h -c "maintenance planifiée staging" -a "$USER"
docker compose exec alertmanager amtool silence query --alertmanager.url=http://localhost:9093
multipass exec taskflow-web1 -- sudo systemctl stop taskflow-api
```

**Résultat attendu :** dans Alertmanager l'alerte est bien *firing* mais marquée **silenced** ; aucun mail, aucun message Discord. Redémarrez l'API et expirez le silence (`amtool silence expire <id>` ou UI).

> Le silence est l'outil de l'exploitant, pas du développeur : on ne modifie pas une règle pour faire taire une alerte pendant une maintenance.

---

## Étape 4 : Annotation Grafana à chaque déploiement (30 min)

### 4.1 Token Grafana

Grafana → **Administration → Users and access → Service accounts → Add** : nom `github-actions`, rôle **Editor** → *Add service account token* → copiez `glsa_…`.

```bash
gh secret set GRAFANA_TOKEN --body 'glsa_xxxxxxxx'
gh variable set GRAFANA_URL --body 'http://host.docker.internal:3001'
```

> `host.docker.internal` : vu depuis le conteneur runner, c'est votre poste, où Grafana écoute sur `3001`. Sous Linux, le compose du runner déclare `extra_hosts: host.docker.internal:host-gateway` pour que ce nom existe (ou utilisez l'IP de l'hôte / `network_mode: host`).

### 4.2 Job `annotate-grafana` dans `deploy.yml`

```yaml
  annotate-grafana:
    name: 📝 Annotation Grafana
    needs: [smoke-staging]
    if: always() && needs.smoke-staging.result == 'success'
    runs-on: [self-hosted, lab]
    steps:
      - name: Poser l'annotation de déploiement
        env:
          GRAFANA_URL: ${{ vars.GRAFANA_URL }}
          GRAFANA_TOKEN: ${{ secrets.GRAFANA_TOKEN }}
        run: |
          curl -fsS -X POST "$GRAFANA_URL/api/annotations" \
            -H "Authorization: Bearer $GRAFANA_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{"tags":["deploy","staging"],"text":"Deploy #${{ github.run_number }} — ${{ github.sha }} par ${{ github.actor }}"}'
```

Ajoutez le même job après `smoke-prod` avec le tag `production` (ou un seul job avec une matrice `env: [staging, production]` et `needs` adaptés).

### 4.3 Afficher les annotations dans le dashboard

*TaskFlow RED → Settings → Annotations → New* : datasource **Grafana**, *Filter by* : Tags → `deploy`. Enregistrez, ré-exportez le JSON.

Poussez un commit → approuvez la prod → **Résultat attendu :** une ligne verticale « Deploy #N » sur tous les panels, au moment exact du déploiement. Si une courbe de latence bouge juste après, vous savez **pourquoi**.

```bash
git add . && git commit -m "feat(monitoring): alerting complet + annotations de déploiement" && git push
```

---

## Bonus : logs avec Loki + Promtail (15 min)

Ajoutez au compose :

```yaml
  loki:
    image: grafana/loki:3.1.0
    ports: ["3100:3100"]
    command: -config.file=/etc/loki/local-config.yaml
    networks: [monitoring]

  promtail:
    image: grafana/promtail:3.1.0
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./loki/promtail-config.yml:/etc/promtail/config.yml:ro
    command: -config.file=/etc/promtail/config.yml
    networks: [monitoring]
```

`loki/promtail-config.yml` (découverte des conteneurs Docker) :

```yaml
server: { http_listen_port: 9080 }
positions: { filename: /tmp/positions.yaml }
clients: [{ url: http://loki:3100/loki/api/v1/push }]
scrape_configs:
  - job_name: docker
    docker_sd_configs: [{ host: unix:///var/run/docker.sock }]
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: container
```

Datasource Loki (`url: http://loki:3100`) dans le provisioning, puis dans *Explore* : `{container="prometheus"} |= "error"`. Pour les logs de l'**API sur les VMs**, il faudrait un Promtail sur chaque VM (rôle Ansible `promtail`, `journal` scrape de `taskflow-api`) : à faire si le temps le permet.

---

## Livrable & critères de validation

**Livrable :** repo `taskflow-ops` final : `monitoring/` complet (compose 8 services, règles, Alertmanager), job `lint-monitoring` vert dans `CI`, `deploy.yml` avec annotations Grafana, dashboard mis à jour. **C'est l'état de ce repo qui est noté.**

### Checklist

- [ ] cAdvisor, blackbox_exporter, Alertmanager, MailHog dans le compose ; 10 targets UP ; `probe_success` = 1
- [ ] `rules/taskflow.yml` : 2 recording rules + 7 alertes avec `for`, `severity`, `summary`, `description` ; `promtool check rules` OK
- [ ] Job `lint-monitoring` (promtool + amtool) dans `ci.yml`, vert
- [ ] `alertmanager.yml` : route par défaut mail, sous-route critical → Discord/Slack, grouping, `inhibit_rules` ; `amtool check-config` OK ; webhook **non committé**
- [ ] Alerte `TaskFlowApiDown` reçue (MailHog et/ou Discord) puis `RESOLVED` ; silence posé et vérifié
- [ ] Annotations `deploy` posées par le workflow et visibles sur le dashboard
- [ ] Aucun secret en clair dans le repo

### Critères notés (Bloc 4 — 25 points)

| Critère | Points |
|---|---|
| Infra + disponibilité : cAdvisor, blackbox (relabeling correct), panels infra, `predict_linear` | 5 |
| Règles d'alerte pertinentes (symptômes, `for`, severity, annotations, recording rules) validées par `promtool` | 7 |
| Alertmanager : routage par severity, receivers mail + webhook, grouping, inhibition ; alerte réellement reçue ; silence | 6 |
| Monitoring as code : job `lint-monitoring` dans le CI, config versionnée sans secret | 4 |
| Annotation Grafana de déploiement (job dans `deploy.yml`, secret/variable, visible sur le dashboard) | 3 |

---

## Erreurs courantes

**`probe_success` = 0 alors que `/health` répond dans le navigateur**
Le conteneur blackbox ne joint pas l'IP de la VM (réseau Docker) : testez `docker compose exec blackbox-exporter wget -qO- http://192.168.64.11/health`. Même remède que pour le runner (`setup-lab.md` § Réseau).

**L'alerte est *Firing* dans Prometheus mais n'arrive jamais dans Alertmanager**
Bloc `alerting:` absent de `prometheus.yml`, ou reload non fait. *Status → Runtime & Build* doit lister `alertmanager:9093`.

**Mail présent dans MailHog mais rien sur Discord**
Le webhook est faux (`docker compose logs alertmanager | grep -i discord`), ou l'alerte n'est pas `critical` (seule sous-route vers Discord).

**`amtool check-config` : `unsupported scheme "" for URL`**
`webhook_url` vide ou mal indenté dans `discord_configs`.

**`curl: (22) ... 401` sur `/api/annotations`**
Token de service account expiré/invalide ou rôle *Viewer* (il faut *Editor*).

**`Could not resolve host: host.docker.internal` depuis le runner**
Sous Linux, ajoutez `extra_hosts: ["host.docker.internal:host-gateway"]` au service `runner` (ou `network_mode: host` + `GRAFANA_URL=http://localhost:3001`).

---

## Ressources

- [Prometheus — Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Alertmanager — Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [blackbox_exporter](https://github.com/prometheus/blackbox_exporter)
- [cAdvisor](https://github.com/google/cadvisor)
- [Grafana — Annotations HTTP API](https://grafana.com/docs/grafana/latest/developers/http_api/annotations/)
- [Google SRE Book — Practical Alerting](https://sre.google/sre-book/practical-alerting/)
- [Cheatsheet Alerting du cours](../../ressources/cheatsheet-alerting.md)

---

**Suite** : QCM final (45 min) — voir [`../../evaluation/`](../../evaluation/README.md)
