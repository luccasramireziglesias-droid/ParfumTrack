// GET /version — devuelve la versión actual del app y metadatos
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Devolver versión actual
    // En producción, esto podría venir de un KV store para poder hacer rollbacks sin redeploy
    const version = '1.8.0';
    const hash = 'default'; // Placeholder para integridad futura
    const timestamp = new Date().toISOString();

    return new Response(
      JSON.stringify({
        version,
        hash,
        timestamp,
        minVersion: '1.0.0', // Versión mínima permitida
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60', // Cache por 1 minuto en CDN
        },
      }
    );
  },
};
