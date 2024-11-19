import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mintAddress } = req.query;

  if (!mintAddress || typeof mintAddress !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid mintAddress' });
  }

  try {
    const response = await fetch(`https://pump.fun/api/coin/${mintAddress}`);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching from pump.fun:', error);
    res.status(500).json({ error: 'Failed to fetch token data' });
  }
}
