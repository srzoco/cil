// Tareas Barquero — función «avisos» (Supabase Edge Function).
// Corre cada minuto (la llama pg_cron), pide a la base de datos los avisos pendientes y los manda
// como notificación a los teléfonos suscritos (Web Push con claves VAPID). No usa librerías externas.
//
// Secretos que hay que crear en Supabase → Edge Functions → Secrets:
//   VAPID_PUBLIC   clave pública  (la misma que va en config.js)
//   VAPID_PRIVATE  clave privada  (nunca en config.js)
//   VAPID_SUBJECT  mailto:tu@correo.com
//   AVISOS_SECRETO una palabra secreta larga (la misma del cron)
// Supabase ya da SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Si tu proyecto solo tiene las claves nuevas,
// crea también CLAVE_SECRETA con la clave «secret» (sb_secret_…).

// ---------- Web Push (RFC 8291 aes128gcm + VAPID RFC 8292) ----------
const te = new TextEncoder();
function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function desdeB64u(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function unir(...partes: Uint8Array[]): Uint8Array {
  const n = partes.reduce((t, p) => t + p.length, 0), out = new Uint8Array(n);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, largo: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, largo * 8));
}
export async function cifrar(texto: string, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const uaPublic = desdeB64u(p256dh), auth = desdeB64u(authSecret);
  const efimera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', efimera.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, efimera.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, unir(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const clave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plano = unir(te.encode(texto), new Uint8Array([2]));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, clave, plano));
  const rs = new Uint8Array([0, 0, 16, 0]);  // 4096
  return unir(salt, rs, new Uint8Array([asPublic.length]), asPublic, cifrado);
}
export async function jwtVapid(audiencia: string, sujeto: string, publica: string, privada: string): Promise<string> {
  const pub = desdeB64u(publica);
  const jwk = { kty: 'EC', crv: 'P-256', d: privada, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cab = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = b64u(te.encode(JSON.stringify({ aud: audiencia, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujeto })));
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(cab + '.' + cuerpo));
  return cab + '.' + cuerpo + '.' + b64u(firma);
}
export async function enviarPush(sub: { endpoint: string; p256dh: string; auth: string }, datos: unknown,
                                 vapid: { publica: string; privada: string; sujeto: string }): Promise<number> {
  const cuerpo = await cifrar(JSON.stringify(datos), sub.p256dh, sub.auth);
  const jwt = await jwtVapid(new URL(sub.endpoint).origin, vapid.sujeto, vapid.publica, vapid.privada);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '900', Urgency: 'high',
               Authorization: 'vapid t=' + jwt + ', k=' + vapid.publica },
    body: cuerpo,
  });
  return r.status;
}
// ---------- fin Web Push ----------

declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req: Request) => {
  const env = (k: string) => Deno.env.get(k) || '';
  if (!env('AVISOS_SECRETO') || req.headers.get('x-aviso-secreto') !== env('AVISOS_SECRETO')) return new Response('no', { status: 401 });
  const url = env('SUPABASE_URL'), clave = env('CLAVE_SECRETA') || env('SUPABASE_SERVICE_ROLE_KEY');
  const cab: Record<string, string> = { apikey: clave, 'Content-Type': 'application/json' };
  if (clave.startsWith('eyJ')) cab.Authorization = 'Bearer ' + clave;
  const vapid = { publica: env('VAPID_PUBLIC'), privada: env('VAPID_PRIVATE'), sujeto: env('VAPID_SUBJECT') || 'mailto:avisos@example.com' };

  const r = await fetch(url + '/rest/v1/rpc/avisos_pendientes', { method: 'POST', headers: cab, body: '{}' });
  if (!r.ok) return new Response('base de datos: ' + r.status + ' ' + await r.text(), { status: 500 });
  const avisos = await r.json() as Array<{ endpoint: string; p256dh: string; auth: string; titulo: string; cuerpo: string; url: string }>;
  let ok = 0, fallos = 0;
  for (const a of avisos) {
    try {
      const st = await enviarPush(a, { titulo: a.titulo, cuerpo: a.cuerpo, url: a.url || './' }, vapid);
      if (st >= 200 && st < 300) ok++;
      else {
        fallos++;
        // 404/410: el teléfono ya no tiene esa suscripción (desinstaló la app, cambió de teléfono)
        if (st === 404 || st === 410) await fetch(url + '/rest/v1/suscripciones?endpoint=eq.' + encodeURIComponent(a.endpoint), { method: 'DELETE', headers: cab });
      }
    } catch (_e) { fallos++; }
  }
  return new Response(JSON.stringify({ enviados: ok, fallos }), { headers: { 'Content-Type': 'application/json' } });
});
