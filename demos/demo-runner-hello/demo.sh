#!/usr/bin/env bash
# Démo J1 — bloc 1.2 : installer un runner self-hosted (≈ 5 min)
set -euo pipefail
cd "$(dirname "$0")/../../ressources/lab/runner"
echo "1. Montrer Settings → Actions → Runners → New self-hosted runner (procédure native config.sh)"
echo "2. cp .env.example .env → renseigner REPO_URL et RUNNER_TOKEN, puis :"
docker compose up -d --build
docker compose logs -f runner &      # attendre "Listening for Jobs"
sleep 20; kill %1 || true
echo "3. Rafraîchir la page Runners : lab-runner Idle + labels"
echo "4. Copier hello-runner.yml dans le repo de démo, lancer : comparer github-hosted vs self-hosted"
