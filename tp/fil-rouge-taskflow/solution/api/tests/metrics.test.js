/**
 * Tests de l'instrumentation Prometheus (J3).
 */
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { register } from '../src/metrics.js'

describe('GET /metrics', () => {
  it('expose le format texte Prometheus', async () => {
    const app = createApp()
    const res = await request(app).get('/metrics')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.text).toContain('# HELP http_requests_total')
    expect(res.text).toContain('# TYPE http_request_duration_seconds histogram')
    expect(res.text).toContain('taskflow_tasks_total')
    expect(res.text).toContain('process_cpu_seconds_total')
  })

  it('compte les requêtes avec method, route normalisée et status_code', async () => {
    const app = createApp()
    await request(app).get('/api/tasks')
    const created = await request(app).post('/api/tasks').send({ text: 'm' })
    await request(app).patch(`/api/tasks/${created.body.id}/toggle`)

    const res = await request(app).get('/metrics')

    expect(res.text).toMatch(
      /http_requests_total\{[^}]*method="GET"[^}]*route="\/api\/tasks"[^}]*status_code="200"/
    )
    expect(res.text).toMatch(/route="\/api\/tasks\/:id\/toggle"/)
    // L'id réel ne doit jamais apparaître dans un label (cardinalité)
    expect(res.text).not.toContain(created.body.id)
  })

  it('met à jour la gauge métier taskflow_tasks_total', async () => {
    const app = createApp()
    await request(app).post('/api/tasks').send({ text: 'a' })
    await request(app).post('/api/tasks').send({ text: 'b' })

    const metrics = await register.getSingleMetric('taskflow_tasks_total').get()

    expect(metrics.values[0].value).toBe(2)
  })
})
