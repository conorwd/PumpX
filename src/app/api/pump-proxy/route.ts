import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mintAddress = searchParams.get('mintAddress');

    if (!mintAddress) {
      return NextResponse.json({ error: 'Missing mintAddress parameter' }, { status: 400 });
    }

    const url = `https://frontend-api.pump.fun/coins/${mintAddress}`;
    
    console.log('Fetching from pump.fun:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Origin': 'https://pump.fun',
        'Referer': 'https://pump.fun/',
      },
    });

    if (!response.ok) {
      console.error('Pump.fun API error:', {
        status: response.status,
        statusText: response.statusText,
      });
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return NextResponse.json(
        { error: `Pump.fun API error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Pump.fun proxy error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
