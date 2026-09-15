#!/usr/bin/env bash
set -e; cd "$(dirname "$0")"
docker compose up -d
echo "Prometheus : http://localhost:9090  — node-exporter : http://localhost:9100/metrics"
echo "Générer de la charge CPU pour la requête 4 :  yes > /dev/null &  (puis kill %1)"
echo "Requêtes : voir queries.md"
