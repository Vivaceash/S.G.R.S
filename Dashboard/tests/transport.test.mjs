import test from 'node:test';
import assert from 'node:assert/strict';
import { request, isLocalOrPrivateHost } from '../src/domain.mjs';

test('isLocalOrPrivateHost reconoce localhost, red privada y nombres locales', () => {
  assert.equal(isLocalOrPrivateHost('localhost'), true);
  assert.equal(isLocalOrPrivateHost('127.0.0.1'), true);
  assert.equal(isLocalOrPrivateHost('[::1]'), true);
  assert.equal(isLocalOrPrivateHost('::1'), true);
  assert.equal(isLocalOrPrivateHost('192.168.38.250'), true);
  assert.equal(isLocalOrPrivateHost('192.168.1.100'), true);
  assert.equal(isLocalOrPrivateHost('10.0.1.5'), true);
  assert.equal(isLocalOrPrivateHost('172.16.0.1'), true);
  assert.equal(isLocalOrPrivateHost('172.31.255.254'), true);
  assert.equal(isLocalOrPrivateHost('169.254.1.1'), true);
  assert.equal(isLocalOrPrivateHost('equipo.local'), true);
  assert.equal(isLocalOrPrivateHost('servidor.lan'), true);

  // IPs y dominios públicos
  assert.equal(isLocalOrPrivateHost('192.0.2.20'), false);
  assert.equal(isLocalOrPrivateHost('172.15.0.1'), false);
  assert.equal(isLocalOrPrivateHost('172.32.0.1'), false);
  assert.equal(isLocalOrPrivateHost('8.8.8.8'), false);
  assert.equal(isLocalOrPrivateHost('dashboard.example.com'), false);
  assert.equal(isLocalOrPrivateHost(''), false);
  assert.equal(isLocalOrPrivateHost(null), false);
});

test('HTTP de red pública no envía credenciales, configuración ni cookies de sesión', async () => {
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const host of ['http://192.0.2.20:3000', 'http://8.8.8.8:3000', 'http://dashboard.publico.com:3000']) {
      globalThis.location = new URL(host);
      globalThis.fetch = async () => { calls++; throw new Error('No debe enviar'); };
      for (const path of ['/api/auth/login', '/api/auth/bootstrap', '/api/admin/users/save', '/api/admin/connections/save', '/api/auth/session']) {
        await assert.rejects(request(path, { body: { password: 'solo-prueba' } }), /HTTPS/);
      }
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  }
});

test('HTTPS, desarrollo local y red privada LAN mantienen solicitudes al mismo origen', async () => {
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  try {
    for (const origin of [
      'https://dashboard.example',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://192.168.38.250:3000',
      'http://192.168.1.150:3000',
      'http://10.20.30.40:3000',
      'http://172.16.10.5:3000',
      'http://172.31.0.1:3000',
    ]) {
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
