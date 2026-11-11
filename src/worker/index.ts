import { Hono } from 'hono';

// Fase 0: solo un punto de comprobación. La API real (sesiones, D1) llega en la fase 1.
const app = new Hono<{ Bindings: Env }>();

app.get('/api/salud', (c) => c.json({ ok: true, fase: 0 }));

app.all('/api/*', (c) => c.json({ error: 'No encontrado' }, 404));

export default app;
