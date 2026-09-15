# 10 requêtes PromQL à taper en direct (http://localhost:9090/graph)

```promql
up                                                        # 1. qui est scrapé ? (1 = OK)
node_cpu_seconds_total                                    # 2. un compteur brut : inutile tel quel
rate(node_cpu_seconds_total{mode="idle"}[1m])             # 3. rate() : dérivée par seconde
100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100   # 4. % CPU utilisé
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100               # 5. % mémoire dispo
rate(node_network_receive_bytes_total{device!="lo"}[1m])  # 6. débit réseau entrant
sum by (job) (rate(prometheus_http_requests_total[1m]))   # 7. agrégation par label
histogram_quantile(0.9, sum by (le) (rate(prometheus_http_request_duration_seconds_bucket[5m])))  # 8. p90
predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[10m], 3600)          # 9. prévision à 1 h
absent(up{job="taskflow-api"})                            # 10. alerter sur ce qui N'EXISTE PAS
```

Astuces à montrer : bouton *Table* vs *Graph*, `[1m]` vs `[5m]`, le piège du `rate` sur une gauge,
`Status → Targets`, `Status → Configuration`, `curl localhost:9100/metrics | head`.
