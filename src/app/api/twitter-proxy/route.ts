import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const type = searchParams.get('type');

    console.log('Twitter proxy request:', { query, type }); // Log incoming request

    if (!query || !type) {
      console.error('Missing parameters:', { query, type });
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_SOCIALDATA_API_KEY; 
    if (!apiKey) {
      console.error('NEXT_PUBLIC_SOCIALDATA_API_KEY is not set');
      return NextResponse.json({ error: 'API key configuration error' }, { status: 500 });
    }

    // Build the search query - add retweet filtering only if not present
    const searchQuery = query.includes('-filter:retweets') ? query : `${query} -filter:retweets`;
    const encodedQuery = encodeURIComponent(searchQuery);
    
    // Always use 'Latest' type for real-time results
    const searchType = 'Latest';
    const baseUrl = 'https://api.socialdata.tools/twitter/search';
    const url = `${baseUrl}?query=${encodedQuery}&type=${searchType}`;
    
    console.log('Twitter API request:', {
      type,
      searchQuery,
      url
    });
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Twitter API error:', {
        status: response.status,
        statusText: response.statusText,
        type,
        query: searchQuery
      });
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return NextResponse.json(
        { error: `Twitter API error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Log success response
    console.log('Twitter API success:', {
      type,
      tweetCount: data.tweets?.length ?? 0,
      firstTweetText: data.tweets?.[0]?.full_text?.substring(0, 100)
    });
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Twitter proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}