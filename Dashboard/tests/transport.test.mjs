import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/domain.mjs';

test('HTTP de red no envía credenciales, configuración ni cookies de sesión', async () => {
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.location = new URL('http://192.0.2.20:3000');
    globalThis.fetch = async () => { calls++; throw new Error('No debe enviar'); };
    for (const path of ['/api/auth/login', '/api/auth/bootstrap', '/api/admin/users/save', '/api/admin/connections/save', '/api/auth/session']) {
      await assert.rejects(request(path, { body: { password: 'solo-prueba' } }), /HTTPS/);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  }
});

test('HTTPS y desarrollo local mantienen solicitudes al mismo origen', async () => {
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  try {
    for (const origin of ['https://dashboard.example', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      globalThis.location = new URL(origin);
      let calls = 0;
      globalThis.fetch = async (path, options) => {
        calls++;
        assert.equal(path, '/api/auth/login');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.redirect, 'error');
        return { ok: true, json: async () => ({ user: 'test' }) };
      };
      assert.deepEqual(await request('/api/auth/login', { body: { password: 'solo-prueba' } }), { user: 'test' });
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  }
});
