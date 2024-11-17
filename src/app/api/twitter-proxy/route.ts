import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const type = searchParams.get('type');

    if (!query || !type) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const apiKey = process.env.SOCIALDATA_API_KEY;
    if (!apiKey) {
      console.error('SOCIALDATA_API_KEY is not set');
      return NextResponse.json({ error: 'API key configuration error' }, { status: 500 });
    }

    const baseUrl = 'https://api.socialdata.tools/twitter/search';
    const encodedQuery = encodeURIComponent(query);
    const url = `${baseUrl}?query=${encodedQuery}&type=${type}`;
    
    console.log('Fetching from:', url); // Debug log
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Twitter API error:', {
        status: response.status,
        statusText: response.statusText,
      });
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return NextResponse.json(
        { error: `Twitter API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) { // Type assertion for error
    console.error('Twitter proxy error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
