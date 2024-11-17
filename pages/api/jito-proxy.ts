import { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jitoRpcUrl = process.env.NEXT_PUBLIC_JITO_RPC_URL;
  if (!jitoRpcUrl) {
    return res.status(500).json({ error: 'Jito RPC URL not configured' });
  }

  try {
    // Forward the RPC request to Jito
    const response = await fetch(jitoRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: req.body.id,
        method: req.body.method,
        params: req.body.params,
      }),
    });

    if (!response.ok) {
      console.error('Jito RPC error:', response.status, await response.text());
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    return res.status(200).json(data);
  } catch (error) {
    console.error('Jito proxy error:', error);
    return res.status(500).json({ 
      jsonrpc: '2.0',
      id: req.body.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}
