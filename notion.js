exports.handler = async function(event) {
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const NOTION_VERSION = '2022-06-28';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const { path, method, body } = JSON.parse(event.body);

    const res = await fetch('https://api.notion.com/v1' + path, {
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json();

    return {
      statusCode: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message })
    };
  }
};
