const https = require('https');

const NOTION_TOKEN = process.env.NOTION_TOKEN;

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { action, ...payload } = JSON.parse(event.body || '{}');

    if (action === 'findLead') {
      const { email, dbId } = payload;
      const res = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
        filter: { property: 'Email', email: { equals: email } }
      });
      return { statusCode: 200, headers, body: JSON.stringify({ result: res.data.results?.[0] || null }) };
    }

    if (action === 'upsertLead') {
      const { email, fields, dbId } = payload;
      const findRes = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
        filter: { property: 'Email', email: { equals: email } }
      });
      const existing = findRes.data.results?.[0];
      const simUrl = fields.simUrl || ('https://stirring-crepe-ab9f33.netlify.app/?email=' + encodeURIComponent(email) + '&prenom=' + encodeURIComponent(fields.prenom || 'Vous') + '&capital=' + (fields.capital || 0));
      const props = {
        'Prénom':          { title: [{ text: { content: fields.prenom || 'Vous' } }] },
        'Email':           { email },
        'Capital départ':  { number: fields.capitalDepart || fields.capital || 0 },
        'Objectif cible':  { number: fields.cible || 5000 },
        'Lien simulation': { url: simUrl },
        'Statut':          { select: { name: '🟡 En cours' } },
      };
      if (fields.epargne) props['Épargne / mois'] = { number: fields.epargne };
      if (!existing) props['Date inscription'] = { date: { start: new Date().toISOString().split('T')[0] } };
      let pageId;
      if (existing) {
        await notionRequest('PATCH', `/v1/pages/${existing.id}`, { properties: props });
        pageId = existing.id;
      } else {
        const res = await notionRequest('POST', '/v1/pages', { parent: { database_id: dbId }, properties: props });
        pageId = res.data.id;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ id: pageId }) };
    }

    if (action === 'saveVersement') {
      const { email, prenom, montant, capitalTotal, moisKey, leadPageId, dbId } = payload;
      const findRes = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
        filter: { and: [{ property: 'Email', email: { equals: email } }, { property: 'Mois déclaré', rich_text: { equals: moisKey } }] }
      });
      const existing = findRes.data.results?.[0];
      const [year, month] = moisKey.split('-');
      const props = {
        'Prénom':               { title: [{ text: { content: prenom || 'Vous' } }] },
        'Email':                { email },
        'Montant versé':        { number: montant },
        'Capital total actuel': { number: capitalTotal },
        'Mois déclaré':         { rich_text: [{ text: { content: moisKey } }] },
        'Date déclaration':     { date: { start: year + '-' + month + '-01' } },
      };
      if (leadPageId) props['Lead associé'] = { relation: [{ id: leadPageId }] };
      if (existing) {
        await notionRequest('PATCH', `/v1/pages/${existing.id}`, { properties: props });
      } else {
        await notionRequest('POST', '/v1/pages', { parent: { database_id: dbId }, properties: props });
      }
      if (leadPageId) {
        await notionRequest('PATCH', `/v1/pages/${leadPageId}`, { properties: { 'Capital départ': { number: capitalTotal } } });
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'loadVersements') {
      const { email, dbId } = payload;
      const res = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
        filter: { property: 'Email', email: { equals: email } },
        sorts: [{ property: 'Date déclaration', direction: 'ascending' }]
      });
      const versements = {};
      for (const page of (res.data.results || [])) {
        const mois    = page.properties['Mois déclaré']?.rich_text?.[0]?.plain_text;
        const montant = page.properties['Montant versé']?.number;
        if (mois && montant != null) versements[mois] = montant;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ versements }) };
    }

    if (action === 'setStatut') {
      const { leadPageId, statut, capital } = payload;
      const props = { 'Statut': { select: { name: statut } } };
      if (capital != null) props['Capital départ'] = { number: capital };
      await notionRequest('PATCH', `/v1/pages/${leadPageId}`, { properties: props });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'deleteVersement') {
      const { email, moisKey, dbId } = payload;
      const findRes = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
        filter: { and: [{ property: 'Email', email: { equals: email } }, { property: 'Mois déclaré', rich_text: { equals: moisKey } }] }
      });
      const page = findRes.data.results?.[0];
      if (page) await notionRequest('PATCH', `/v1/pages/${page.id}`, { archived: true });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue: ' + action }) };

  } catch (err) {
    console.error('notion function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
