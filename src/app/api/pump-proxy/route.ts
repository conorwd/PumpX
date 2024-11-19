import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mintAddress = searchParams.get('mintAddress');

    if (!mintAddress) {
      return NextResponse.json(
        { error: 'Missing or invalid mintAddress' },
        { status: 400 }
      );
    }

    console.log('Fetching data for mintAddress:', mintAddress);
    
    // Try the v1 API first
    const v1Response = await fetch(`https://pump.fun/api/v1/coins/${mintAddress}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      cache: 'no-store'
    });

    if (v1Response.ok) {
      const data = await v1Response.json();
      return NextResponse.json(data);
    }

    console.log('V1 API failed, trying frontend API');

    // Fallback to frontend API
    const frontendResponse = await fetch(`https://frontend-api.pump.fun/coins/${mintAddress}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Origin': 'https://pump.fun',
        'Referer': 'https://pump.fun/',
      },
      cache: 'no-store'
    });

    if (!frontendResponse.ok) {
      const errorText = await frontendResponse.text();
      console.error('Frontend API error:', {
        status: frontendResponse.status,
        statusText: frontendResponse.statusText,
        body: errorText
      });
      throw new Error(`API responded with status: ${frontendResponse.status}`);
    }

    const data = await frontendResponse.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Error in pump-proxy:', error);
    return NextResponse.json(
      { error: 'Failed to fetch token data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
