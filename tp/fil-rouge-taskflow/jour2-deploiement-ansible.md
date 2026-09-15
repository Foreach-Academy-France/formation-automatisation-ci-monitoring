# TP Jour 2 : Déploiement automatisé GitHub Actions + Ansible

> **Durée** : ~3h45 | **Objectif** : Construire le workflow `deploy.yml` qui build **une seule fois** l'artefact TaskFlow, le déploie sur la VM *staging* via Ansible depuis le runner self-hosted, vérifie la santé de l'API, attend une **approbation** dans l'environment `production`, déploie en prod, et sait revenir en arrière (`rollback_to`).

---

## Prérequis

- TP1 terminé : repo `taskflow-ops` avec un CI vert et le runner `lab-runner` en ligne
- Multipass (ou Incus) fonctionnel — le lab du cours Ansible
- `ansible` installé en local pour les tests manuels (`ansible --version`)
- Une clé SSH dédiée au lab : `~/.ssh/taskflow_lab` (créée par `lab-up.sh` si absente)

---

## Étape 1 : Lab, inventaire, environments et secrets (30 min)

### 1.1 Créer (ou recréer) les deux VMs

```bash
cd <repo de la formation>/ressources/lab
./lab-up.sh
```

**Résultat attendu :**

```
==> VMs prêtes
Name             State    IPv4
taskflow-web1    Running  192.168.64.11
taskflow-web2    Running  192.168.64.12

==> Extrait d'inventaire à coller dans ansible/inventory/hosts.ini :
[staging]
taskflow-web1 ansible_host=192.168.64.11

[prod]
taskflow-web2 ansible_host=192.168.64.12
```

> Les VMs du cours Ansible sont réutilisables telles quelles : `lab-up.sh` ne recrée que celles qui manquent et réinjecte la clé publique.

### 1.2 Renseigner l'inventaire

Dans `~/taskflow-ops/ansible/inventory/hosts.ini` :

```ini
[staging]
taskflow-web1 ansible_host=192.168.64.11

[prod]
taskflow-web2 ansible_host=192.168.64.12

[web:children]
staging
prod

[web:vars]
ansible_user=ubuntu
ansible_ssh_private_key_file=~/.ssh/taskflow_lab
```

Test local :

```bash
cd ~/taskflow-ops
ansible-galaxy collection install -r ansible/requirements.yml
ansible -i ansible/inventory/hosts.ini all -m ping
```

**Résultat attendu :** `pong` pour `taskflow-web1` et `taskflow-web2`.

### 1.3 Créer les environments GitHub

**Settings → Environments → New environment** :

| Environment | Protection | Variable | Secrets |
|---|---|---|---|
| `staging` | aucune | `TARGET_IP` = IP de web1 | `SSH_PRIVATE_KEY`, `ANSIBLE_VAULT_PASSWORD` |
| `production` | ☑ **Required reviewers** : vous-même | `TARGET_IP` = IP de web2 | `SSH_PRIVATE_KEY`, `ANSIBLE_VAULT_PASSWORD` |

Avec `gh` (plus rapide, à répéter pour `production`) :

```bash
gh api -X PUT repos/<vous>/taskflow-ops/environments/staging
gh secret set SSH_PRIVATE_KEY --env staging < ~/.ssh/taskflow_lab
gh secret set ANSIBLE_VAULT_PASSWORD --env staging --body 'formation-vault-2026'
gh variable set TARGET_IP --env staging --body '192.168.64.11'
```

Les *required reviewers* de `production` se configurent dans l'UI.

> **Pourquoi des secrets par environment ?** Un job qui ne déclare pas `environment: production` ne peut **pas** lire ses secrets. C'est ce qui garantit qu'un workflow modifié sur une branche ne peut pas déployer en prod sans passer par l'approbation.

### 1.4 Vérifier que le runner joint les VMs

Créez `.github/workflows/ansible-ping.yml` :

```yaml
name: Ansible ping
on: [workflow_dispatch]
jobs:
  ping:
    runs-on: [self-hosted, lab]
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}
      - run: ansible -i ansible/inventory/hosts.ini all -m ping
        env:
          ANSIBLE_HOST_KEY_CHECKING: "False"
```

```bash
git add . && git commit -m "ci: inventaire + ping depuis le runner" && git push
gh workflow run ansible-ping.yml && gh run watch
```

**Résultat attendu :** `pong` pour les deux VMs depuis le **conteneur** runner. Un avertissement `Identity file /home/runner/.ssh/taskflow_lab not accessible` est normal : la clé vient de l'agent SSH, pas du fichier.

> **Le runner ne joint pas les VMs ?** Sous Linux, ajoutez `network_mode: host` au service `runner` du compose. Sous macOS/Windows, vérifiez que l'hôte lui-même joint l'IP (`ping 192.168.64.11`). Voir `setup-lab.md` § Réseau.

---

## Étape 2 : Étendre le rôle `taskflow` — releases, API systemd, proxy nginx (1h)

Le rôle du starter déploie seulement `dist/` dans nginx (cours Ansible). Il doit maintenant :

1. installer Node 20 et créer l'utilisateur système `taskflow` ;
2. déposer **chaque version** dans `/opt/taskflow/releases/<app_version>/{dist,api}` ;
3. installer les dépendances de prod de l'API ;
4. basculer le lien symbolique `/opt/taskflow/current` ;
5. lancer l'API en service **systemd** et faire proxyer `/api`, `/health`, `/metrics` par nginx ;
6. ne garder que `keep_releases` versions.

### 2.1 Variables par défaut

`ansible/roles/taskflow/defaults/main.yml` :

```yaml
---
app_name: taskflow
app_root: /opt/taskflow
app_user: taskflow
app_env: local          # surchargé par group_vars/staging.yml et prod.yml
app_server_name: taskflow.local
app_http_port: 80
api_port: 3000
node_major: 20
keep_releases: 5
```

### 2.2 Tâches principales

`ansible/roles/taskflow/tasks/main.yml` :

```yaml
---
- name: Installer nginx et les prérequis
  ansible.builtin.apt:
    name: [nginx, curl, ca-certificates, gnupg, rsync]
    state: present
    update_cache: true
    cache_valid_time: 3600

- name: Ajouter le dépôt NodeSource (Node {{ node_major }})
  ansible.builtin.shell: |
    curl -fsSL https://deb.nodesource.com/setup_{{ node_major }}.x | bash -
  args:
    creates: /etc/apt/sources.list.d/nodesource.list

- name: Installer Node.js
  ansible.builtin.apt:
    name: nodejs
    state: present
    update_cache: true

- name: Créer l'utilisateur système {{ app_user }}
  ansible.builtin.user:
    name: "{{ app_user }}"
    system: true
    shell: /usr/sbin/nologin
    home: "{{ app_root }}"
    create_home: false

- name: Créer l'arborescence des releases
  ansible.builtin.file:
    path: "{{ item }}"
    state: directory
    owner: "{{ app_user }}"
    group: "{{ app_user }}"
    mode: "0755"
  loop:
    - "{{ app_root }}"
    - "{{ app_root }}/releases"
    - "{{ app_root }}/releases/{{ app_version }}"

- name: Copier le front buildé (dist/)
  ansible.builtin.copy:
    src: "{{ playbook_dir }}/../../dist/"
    dest: "{{ app_root }}/releases/{{ app_version }}/dist/"
    owner: "{{ app_user }}"
    group: "{{ app_user }}"
    mode: "0644"
    directory_mode: "0755"

- name: Copier l'API (sans node_modules)
  ansible.posix.synchronize:
    src: "{{ playbook_dir }}/../../api/"
    dest: "{{ app_root }}/releases/{{ app_version }}/api/"
    rsync_opts: ["--exclude=node_modules", "--exclude=reports", "--exclude=coverage"]

- name: Installer les dépendances de production de l'API
  ansible.builtin.command:
    cmd: npm ci --omit=dev
    chdir: "{{ app_root }}/releases/{{ app_version }}/api"
    creates: "{{ app_root }}/releases/{{ app_version }}/api/node_modules"

- name: Déposer la configuration de l'API (.env)
  ansible.builtin.template:
    src: api.env.j2
    dest: "{{ app_root }}/releases/{{ app_version }}/api/.env"
    owner: "{{ app_user }}"
    group: "{{ app_user }}"
    mode: "0640"
  notify: Restart taskflow-api

- name: Donner la release à {{ app_user }}
  ansible.builtin.file:
    path: "{{ app_root }}/releases/{{ app_version }}"
    owner: "{{ app_user }}"
    group: "{{ app_user }}"
    recurse: true

- name: Installer l'unité systemd taskflow-api
  ansible.builtin.template:
    src: taskflow-api.service.j2
    dest: /etc/systemd/system/taskflow-api.service
    mode: "0644"
  notify: Restart taskflow-api

- name: Basculer le lien symbolique current
  ansible.builtin.file:
    src: "{{ app_root }}/releases/{{ app_version }}"
    dest: "{{ app_root }}/current"
    state: link
  notify: Restart taskflow-api

- name: Activer et démarrer taskflow-api
  ansible.builtin.systemd:
    name: taskflow-api
    enabled: true
    state: started
    daemon_reload: true

- name: Installer le vhost nginx
  ansible.builtin.template:
    src: nginx-taskflow.conf.j2
    dest: /etc/nginx/sites-available/taskflow.conf
    mode: "0644"
  notify: Reload nginx

- name: Activer le vhost et retirer le site par défaut
  ansible.builtin.file:
    src: "{{ item.src | default(omit) }}"
    path: "{{ item.path }}"
    state: "{{ item.state }}"
  loop:
    - { src: /etc/nginx/sites-available/taskflow.conf, path: /etc/nginx/sites-enabled/taskflow.conf, state: link }
    - { path: /etc/nginx/sites-enabled/default, state: absent }
  notify: Reload nginx

- name: Lister les releases installées
  ansible.builtin.find:
    paths: "{{ app_root }}/releases"
    file_type: directory
  register: releases

- name: Supprimer les releases au-delà de keep_releases
  ansible.builtin.file:
    path: "{{ item.path }}"
    state: absent
  loop: "{{ (releases.files | sort(attribute='mtime') | map(attribute='path') | list)[:-keep_releases] }}"
  loop_control:
    label: "{{ item.path | basename }}"
  when: releases.files | length > keep_releases
```

> **`synchronize` = rsync** des deux côtés : le rôle installe `rsync` sur la VM, et le conteneur runner l'embarque. Si vous préférez éviter rsync, `copy` fonctionne mais copiera `node_modules` si le dossier existe localement — d'où le `--exclude` dans le `tar` du workflow.

### 2.3 Handlers

`ansible/roles/taskflow/handlers/main.yml` :

```yaml
---
- name: Restart taskflow-api
  ansible.builtin.systemd:
    name: taskflow-api
    state: restarted
    daemon_reload: true

- name: Reload nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded
```

### 2.4 Templates

`ansible/roles/taskflow/templates/api.env.j2` :

```ini
# Généré par Ansible — ne pas éditer sur le serveur
PORT={{ api_port }}
APP_VERSION={{ app_version }}
APP_ENV={{ app_env }}
NODE_ENV=production
```

`ansible/roles/taskflow/templates/taskflow-api.service.j2` :

```ini
[Unit]
Description=TaskFlow API ({{ app_env }})
After=network.target

[Service]
User={{ app_user }}
Group={{ app_user }}
WorkingDirectory={{ app_root }}/current/api
EnvironmentFile={{ app_root }}/current/api/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`ansible/roles/taskflow/templates/nginx-taskflow.conf.j2` :

```nginx
server {
    listen {{ app_http_port }};
    server_name {{ app_server_name }};

    root {{ app_root }}/current/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Tout ce qui concerne l'API est proxyé vers le service Node
    location ~ ^/(api/|health$|metrics$) {
        proxy_pass http://127.0.0.1:{{ api_port }};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 2.5 Variables d'environnement et playbook

`ansible/inventory/group_vars/staging.yml` :

```yaml
---
app_env: staging
app_server_name: staging.taskflow.local
```

`ansible/inventory/group_vars/prod.yml` (en clair pour l'instant, chiffré à l'étape 4) :

```yaml
---
app_env: prod
app_server_name: taskflow.local
```

`ansible/playbooks/deploy.yml` (complétez le squelette) :

```yaml
---
- name: Déployer TaskFlow
  hosts: web
  become: true
  pre_tasks:
    - name: Vérifier que app_version est fourni
      ansible.builtin.assert:
        that: app_version is defined and (app_version | string | length > 0)
        fail_msg: "Passez -e app_version=<numéro de run>"
    - name: Vérifier que le build est présent localement
      ansible.builtin.stat:
        path: "{{ playbook_dir }}/../../dist/index.html"
      delegate_to: localhost
      become: false
      register: dist_stat
      failed_when: not dist_stat.stat.exists
  roles:
    - taskflow
  post_tasks:
    - name: Vérifier la santé de l'API depuis la VM
      ansible.builtin.uri:
        url: "http://127.0.0.1:{{ api_port }}/health"
        return_content: true
      register: health
      retries: 5
      delay: 2
      until: health.status == 200
    - ansible.builtin.debug:
        msg: "{{ inventory_hostname }} ({{ app_env }}) → {{ health.json }}"
```

### 2.6 Test manuel sur staging

```bash
cd ~/taskflow-ops
npm ci && npm run build
ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/deploy.yml -l staging -e app_version=manual-1
curl -s http://192.168.64.11/health
```

**Résultat attendu :**

```
PLAY RECAP *********************************************************************
taskflow-web1 : ok=21   changed=15   unreachable=0    failed=0

{"status":"ok","version":"manual-1","env":"staging","uptime":2.13}
```

Relancez le playbook : `changed=0` (idempotent). Ouvrez `http://192.168.64.11/` : le front TaskFlow s'affiche.

---

## Étape 3 : `deploy.yml` — build once, deploy staging, smoke test (45 min)

### 3.1 Le workflow

Créez `.github/workflows/deploy.yml` :

```yaml
# =============================================================================
# Deploy TaskFlow — build once, deploy many
# push sur main   → build → staging → smoke → (approbation) → prod → smoke
# workflow_dispatch avec rollback_to → rollback prod uniquement (étape 5)
# =============================================================================
name: Deploy

on:
  push:
    branches: [main]
    paths-ignore: ['**.md']
  workflow_dispatch:
    inputs:
      rollback_to:
        description: "Numéro de run à restaurer en prod (laisser vide pour un déploiement normal)"
        type: string
        default: ''

permissions:
  contents: read

# Jamais deux déploiements en même temps ; on n'annule pas celui en cours
concurrency:
  group: deploy
  cancel-in-progress: false

env:
  ANSIBLE_HOST_KEY_CHECKING: "False"
  ANSIBLE_FORCE_COLOR: "true"

jobs:
  # ───────────────────────── Build (une seule fois) ─────────────────────────
  build:
    name: 🔨 Build artefact
    if: ${{ !inputs.rollback_to }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node-project
      - name: Build du front
        run: npm run build
      - name: Empaqueter dist/ + api/ (artefact immuable)
        run: tar czf taskflow-${{ github.run_number }}.tar.gz dist api --exclude=api/node_modules
      - uses: actions/upload-artifact@v4
        with:
          name: taskflow-build
          path: taskflow-${{ github.run_number }}.tar.gz
          retention-days: 30

  # ───────────────────────────── Staging ────────────────────────────────────
  deploy-staging:
    name: 🚀 Deploy staging
    needs: build
    runs-on: [self-hosted, lab]
    environment:
      name: staging
      url: http://${{ vars.TARGET_IP }}
    steps:
      - uses: actions/checkout@v4

      - name: Récupérer l'artefact de build
        uses: actions/download-artifact@v4
        with:
          name: taskflow-build

      - name: Extraire dist/ et api/
        run: tar xzf taskflow-${{ github.run_number }}.tar.gz

      - name: Charger la clé SSH du lab
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}

      - name: Préparer le mot de passe Vault
        run: |
          echo "${{ secrets.ANSIBLE_VAULT_PASSWORD }}" > "$RUNNER_TEMP/.vault_pass"
          chmod 600 "$RUNNER_TEMP/.vault_pass"

      - name: Installer les collections Ansible
        run: ansible-galaxy collection install -r ansible/requirements.yml

      - name: Déployer avec Ansible
        run: |
          ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/deploy.yml \
            -l staging \
            -e app_version=${{ github.run_number }} \
            --vault-password-file "$RUNNER_TEMP/.vault_pass"

      - name: Nettoyer les fichiers sensibles (runner persistant !)
        if: always()
        run: rm -f "$RUNNER_TEMP/.vault_pass" taskflow-*.tar.gz

  smoke-staging:
    name: 🩺 Smoke test staging
    needs: deploy-staging
    runs-on: [self-hosted, lab]
    environment: staging          # nécessaire pour lire vars.TARGET_IP
    steps:
      - name: /health répond ok
        run: |
          curl -fsS --retry 5 --retry-delay 2 "http://${{ vars.TARGET_IP }}/health" | tee health.json
          grep -q '"status":"ok"' health.json
          grep -q "\"version\":\"${{ github.run_number }}\"" health.json
```

```bash
git add . && git commit -m "cd: workflow deploy staging (build once)" && git push
gh run watch
```

**Résultat attendu :** run `Deploy` avec 3 jobs verts : `🔨 Build artefact` (ubuntu-latest), `🚀 Deploy staging` (lab-runner, environment *staging* avec un lien vers `http://192.168.64.11`), `🩺 Smoke test staging`. Le log Ansible affiche `changed` sur les tâches de release et `{"status":"ok","version":"<numéro de run>",…}`.

> **Le build ne se fait qu'une fois.** Le job `deploy-staging` ne lance ni `npm ci` ni `npm run build` : il **télécharge** l'artefact produit par `build`. Le même `.tar.gz` sera déployé en prod : c'est la garantie que ce qui a été testé est ce qui est déployé.

### 3.2 Constater la persistance du workspace

Sur le runner :

```bash
docker compose exec runner ls /tmp/runner/work/taskflow-ops/taskflow-ops
```

Le repo, `dist/` et `api/` sont toujours là. C'est la raison du step de nettoyage `if: always()` : sur un runner self-hosted, **vous** êtes responsable de ne rien laisser traîner (mots de passe Vault, clés, `.env`).

---

## Étape 4 : Production avec approbation et Vault (45 min)

### 4.1 Chiffrer `group_vars/prod.yml`

```bash
cd ~/taskflow-ops
ansible-vault encrypt ansible/inventory/group_vars/prod.yml
# New Vault password: formation-vault-2026   (le même que le secret ANSIBLE_VAULT_PASSWORD)
head -1 ansible/inventory/group_vars/prod.yml
```

**Résultat attendu :** `$ANSIBLE_VAULT;1.1;AES256`. Le fichier est committable : sans le mot de passe, il est illisible.

> Ajoutez-y au passage une variable « sensible » pour la démonstration, par exemple `api_admin_token: s3cr3t-prod`, avec `ansible-vault edit`. Elle n'est pas utilisée par l'application, mais vous verrez qu'elle n'apparaît **jamais** dans les logs GitHub.

### 4.2 Ajouter les jobs prod

Dans `deploy.yml`, à la suite :

```yaml
  # ────────────────────────────── Production ────────────────────────────────
  deploy-prod:
    name: 🚀 Deploy production
    needs: smoke-staging
    runs-on: [self-hosted, lab]
    environment:
      name: production           # required reviewers → le job attend l'approbation
      url: http://${{ vars.TARGET_IP }}
    outputs:
      target_ip: ${{ vars.TARGET_IP }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: taskflow-build
      - run: tar xzf taskflow-${{ github.run_number }}.tar.gz
      - uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}
      - run: |
          echo "${{ secrets.ANSIBLE_VAULT_PASSWORD }}" > "$RUNNER_TEMP/.vault_pass"
          chmod 600 "$RUNNER_TEMP/.vault_pass"
      - run: ansible-galaxy collection install -r ansible/requirements.yml
      - name: Déployer avec Ansible
        run: |
          ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/deploy.yml \
            -l prod \
            -e app_version=${{ github.run_number }} \
            --vault-password-file "$RUNNER_TEMP/.vault_pass"
      - if: always()
        run: rm -f "$RUNNER_TEMP/.vault_pass" taskflow-*.tar.gz

  smoke-prod:
    name: 🩺 Smoke test production
    needs: deploy-prod
    runs-on: [self-hosted, lab]
    steps:
      - name: /health répond ok
        run: |
          curl -fsS --retry 5 --retry-delay 2 "http://${{ needs.deploy-prod.outputs.target_ip }}/health" | tee health.json
          grep -q '"status":"ok"' health.json
```

> **Pourquoi `outputs.target_ip` plutôt que `environment: production` sur `smoke-prod` ?** Chaque job qui déclare `environment: production` déclenche une demande d'approbation. En passant l'IP par une *output* de job, le smoke test s'exécute sans seconde approbation.

```bash
git add . && git commit -m "cd: déploiement production avec approbation" && git push
gh run watch
```

**Résultat attendu :** après `smoke-staging`, le run passe en **Waiting** : « *deploy-prod is waiting for review* ». Un mail/notification GitHub vous invite à approuver. Cliquez **Review deployments → production → Approve and deploy**. Le job démarre, puis `smoke-prod` est vert. `http://192.168.64.12/health` renvoie la même `version` que staging.

### 4.3 Vérifier le masquage des secrets

Dans le log de `Déployer avec Ansible`, cherchez `api_admin_token` : Ansible n'affiche pas les variables par défaut, mais si vous ajoutez un `debug: var=api_admin_token` vous verrez la valeur… **dans le log Ansible**, car GitHub ne masque que les valeurs déclarées comme *secrets* GitHub. Le mot de passe Vault, lui, apparaît sous forme `***` partout.

> Règle : GitHub masque les **secrets GitHub**. Tout ce qu'Ansible déchiffre et affiche est de votre responsabilité : `no_log: true` sur les tâches sensibles.

---

## Étape 5 : Rollback (30 min)

### 5.1 Playbook `rollback.yml`

`ansible/playbooks/rollback.yml` :

```yaml
---
- name: Revenir à une release précédente
  hosts: web
  become: true
  pre_tasks:
    - name: Vérifier rollback_to
      ansible.builtin.assert:
        that: rollback_to is defined and (rollback_to | string | length > 0)
        fail_msg: "Passez -e rollback_to=<numéro de run>"
    - name: Vérifier que la release existe sur le serveur
      ansible.builtin.stat:
        path: "{{ app_root }}/releases/{{ rollback_to }}/api/src/server.js"
      register: rel
      failed_when: not rel.stat.exists
  tasks:
    - name: Rebasculer current
      ansible.builtin.file:
        src: "{{ app_root }}/releases/{{ rollback_to }}"
        dest: "{{ app_root }}/current"
        state: link
      notify:
        - Restart taskflow-api
        - Reload nginx
  handlers:
    - name: Restart taskflow-api
      ansible.builtin.systemd:
        name: taskflow-api
        state: restarted
    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
  post_tasks:
    - ansible.builtin.uri:
        url: "http://127.0.0.1:{{ api_port }}/health"
        return_content: true
      register: health
      retries: 5
      delay: 2
      until: health.status == 200 and health.json.version == (rollback_to | string)
    - ansible.builtin.debug:
        msg: "Rollback OK → {{ health.json }}"
```

### 5.2 Job `rollback` dans `deploy.yml`

```yaml
  # ─────────────────────────────── Rollback ─────────────────────────────────
  rollback:
    name: ⏪ Rollback production
    if: github.event_name == 'workflow_dispatch' && inputs.rollback_to != ''
    runs-on: [self-hosted, lab]
    environment: production        # un rollback aussi se fait sous approbation
    steps:
      - uses: actions/checkout@v4
      - uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}
      - run: |
          echo "${{ secrets.ANSIBLE_VAULT_PASSWORD }}" > "$RUNNER_TEMP/.vault_pass"
          chmod 600 "$RUNNER_TEMP/.vault_pass"
      - name: Rebasculer sur la release ${{ inputs.rollback_to }}
        run: |
          ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/rollback.yml \
            -l prod -e rollback_to=${{ inputs.rollback_to }} \
            --vault-password-file "$RUNNER_TEMP/.vault_pass"
      - if: always()
        run: rm -f "$RUNNER_TEMP/.vault_pass"
```

> Le job `build` porte déjà `if: ${{ !inputs.rollback_to }}` : sur un `push`, `inputs.rollback_to` est vide donc `!''` vaut `true` et le pipeline normal se déroule. Les jobs suivants dépendent de `build` via `needs` : ils sont automatiquement *skipped* lors d'un rollback.

### 5.3 Test grandeur nature

Notez le numéro de run actuellement déployé (`curl http://192.168.64.12/health`), poussez un commit anodin pour obtenir un run N+1 déployé en prod (avec approbation), puis :

```bash
gh workflow run deploy.yml -f rollback_to=<N>
gh run watch
curl -s http://192.168.64.12/health
```

**Résultat attendu :** seul le job `⏪ Rollback production` s'exécute (après approbation) ; `/health` renvoie `"version":"<N>"`. Sur la VM, `ls -l /opt/taskflow/current` pointe vers `releases/<N>`.

---

## Bonus : notification Discord/Slack

Ajoutez un secret `DISCORD_WEBHOOK` (repo) et un job final :

```yaml
  notify:
    name: 📣 Notification
    needs: [smoke-prod]
    if: always() && needs.smoke-prod.result != 'skipped'
    runs-on: ubuntu-latest
    steps:
      - run: |
          STATUS="${{ needs.smoke-prod.result }}"
          curl -fsS -H "Content-Type: application/json" \
            -d "{\"content\":\"TaskFlow prod — run #${{ github.run_number }} : $STATUS\\n${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"}" \
            "${{ secrets.DISCORD_WEBHOOK }}"
```

(Pour Slack, même principe avec `{"text": "..."}`.)

---

## Livrable & critères de validation

**Livrable :** repo `taskflow-ops` avec un run `Deploy` complet vert (staging → approbation → prod), les deux VMs servant TaskFlow front + API, et un rollback démontré.

### Checklist

- [ ] `hosts.ini` contient les groupes `[staging]` et `[prod]` avec les bonnes IP
- [ ] Environments `staging` et `production` créés, `production` avec required reviewer, secrets `SSH_PRIVATE_KEY` / `ANSIBLE_VAULT_PASSWORD` et variable `TARGET_IP` par environment
- [ ] Le rôle `taskflow` déploie dans `releases/<version>`, lien `current`, service systemd `taskflow-api` actif, nginx proxy `/api`, `/health`, `/metrics`
- [ ] `ansible-playbook … deploy.yml` relancé = `changed=0`
- [ ] `deploy.yml` : job `build` unique (artefact), `deploy-staging` sur `[self-hosted, lab]` avec `environment: staging`, smoke test, `deploy-prod` avec `environment: production`, smoke prod
- [ ] `group_vars/prod.yml` commence par `$ANSIBLE_VAULT`
- [ ] Aucun secret en clair dans le repo ni dans les logs (`***`)
- [ ] `rollback.yml` + job `rollback` déclenché par `workflow_dispatch` : `/health` prod affiche la version restaurée

### Critères notés (Bloc 2 — 25 points)

| Critère | Points |
|---|---|
| Rôle `taskflow` : releases + `current`, API en service systemd, vhost nginx avec proxy, idempotent | 7 |
| `deploy.yml` : build once (artefact upload/download), déploiement staging depuis le runner, smoke test | 6 |
| Environments GitHub : secrets/variables par environment, approbation obligatoire en prod, `deploy-prod` + `smoke-prod` | 5 |
| Gestion des configurations : `group_vars` par environnement, `prod.yml` chiffré Vault, nettoyage des fichiers sensibles sur le runner | 4 |
| Rollback fonctionnel (`rollback.yml` + `workflow_dispatch` `rollback_to`) | 3 |

---

## Erreurs courantes

**`UNREACHABLE! => Permission denied (publickey)` depuis le runner**
Le secret `SSH_PRIVATE_KEY` est incomplet (il doit contenir tout le fichier, de `-----BEGIN` à `-----END`), ou le job n'a pas `environment:` et ne voit donc pas le secret d'environment.

**`Unable to locate artifact 'taskflow-build'`**
Le job `build` a été *skipped* (rollback) ou a échoué ; ou vous avez renommé l'artefact d'un côté seulement.

**`Attempting to decrypt but no vault secrets found`**
`--vault-password-file` absent, ou `prod.yml` chiffré avec un autre mot de passe que le secret `ANSIBLE_VAULT_PASSWORD`.

**Le job `deploy-prod` ne demande pas d'approbation**
Les *required reviewers* ne sont pas configurés sur l'environment `production`, ou le job ne déclare pas `environment: production`.

**`taskflow-api.service: Failed with result 'exit-code'`**
`journalctl -u taskflow-api` sur la VM : souvent `node_modules` manquant (le `npm ci --omit=dev` n'a pas tourné à cause de `creates:` sur une release réutilisée) ou `.env` absent.

**`404` sur `/api/tasks` mais `/` fonctionne**
Le site nginx `default` est encore actif ou le `location ~ ^/(api/|health$|metrics$)` est absent ; `nginx -t` puis `systemctl reload nginx`.

---

## Ressources

- [Documentation — Using environments for deployment](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment)
- [Documentation — Storing and sharing data from a workflow (artefacts)](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow)
- [webfactory/ssh-agent](https://github.com/webfactory/ssh-agent)
- [Ansible — module `ansible.posix.synchronize`](https://docs.ansible.com/ansible/latest/collections/ansible/posix/synchronize_module.html)
- [Ansible — Ansible Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html)
- [Cheatsheet GitHub Actions du cours](../../ressources/cheatsheet-github-actions.md)

---

**Prochain TP** : [Jour 3 — Monitorer TaskFlow avec Prometheus et Grafana](./jour3-monitoring-prometheus.md)
