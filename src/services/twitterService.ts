import { Tweet } from '@/types';

interface TweetEntity {
  urls: Array<{
    display_url: string;
    expanded_url: string;
    indices: number[];
    url: string;
  }>;
  hashtags: any[];
  symbols: any[];
  timestamps: any[];
  user_mentions: any[];
}

interface TwitterUser {
  id: number;
  id_str: string;
  name: string;
  screen_name: string;
  location: string | null;
  url: string | null;
  description: string;
  protected: boolean;
  verified: boolean;
  followers_count: number;
  friends_count: number;
  listed_count: number;
  favourites_count: number;
  statuses_count: number;
  created_at: string;
  profile_banner_url: string | null;
  profile_image_url_https: string;
  can_dm: boolean;
}

interface RawTweet {
  tweet_created_at: string;
  id: number;
  id_str: string;
  text: string | null;
  full_text: string;
  source: string;
  truncated: boolean;
  in_reply_to_status_id: number | null;
  in_reply_to_status_id_str: string | null;
  in_reply_to_user_id: number | null;
  in_reply_to_user_id_str: string | null;
  in_reply_to_screen_name: string | null;
  user: TwitterUser;
  quoted_status_id: number | null;
  quoted_status_id_str: string | null;
  is_quote_status: boolean;
  quoted_status: any | null;
  retweeted_status: any | null;
  quote_count: number;
  reply_count: number;
  retweet_count: number;
  favorite_count: number;
  views_count: number | null;
  bookmark_count: number;
  lang: string;
  entities: TweetEntity;
  is_pinned: boolean;
}

interface TwitterSearchResponse {
  tweets: RawTweet[];
  next_cursor: string;
}

export class TwitterService {
  private apiKey: string;
  private lastTweetId: string | null = null;
  private isFirstRequest = true;

  constructor() {
    this.apiKey = process.env.NEXT_PUBLIC_SOCIALDATA_API_KEY || '';
    if (!this.apiKey) {
      console.error('NEXT_PUBLIC_SOCIALDATA_API_KEY is not set in environment variables');
    }
  }

  private buildQuery(): string {
    const baseQuery = 'pump.fun/ -filter:retweets';
    
    if (this.isFirstRequest) {
      // First request: get tweets from last 10 minutes
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);
      return `${baseQuery} since_time:${tenMinutesAgo}`;
    } else if (this.lastTweetId) {
      // Subsequent requests: get tweets newer than last seen tweet
      return `${baseQuery} since_id:${this.lastTweetId}`;
    }
    
    // Fallback to last 30 seconds if something went wrong
    const thirtySecondsAgo = Math.floor(Date.now() / 1000) - 30;
    return `${baseQuery} since_time:${thirtySecondsAgo}`;
  }

  private transformTweet(rawTweet: RawTweet): Tweet {
    return {
      id_str: rawTweet.id_str,
      full_text: rawTweet.full_text,
      user: {
        name: rawTweet.user.name,
        screen_name: rawTweet.user.screen_name,
        profile_image_url_https: rawTweet.user.profile_image_url_https,
        followers_count: rawTweet.user.followers_count,
        friends_count: rawTweet.user.friends_count
      },
      entities: {
        urls: rawTweet.entities.urls.map(url => ({
          expanded_url: url.expanded_url
        }))
      },
      tweet_created_at: rawTweet.tweet_created_at
    };
  }

  async searchTweets(): Promise<Tweet[]> {
    if (!this.apiKey) {
      console.error('Twitter API key is not configured');
      return [];
    }

    try {
      const query = this.buildQuery();
      
      const params = new URLSearchParams({
        query,
        type: 'Latest'
      });

      const response = await fetch(
        `https://api.socialdata.tools/twitter/search?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Twitter API Error:', response.status, errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: TwitterSearchResponse = await response.json();

      if (!data || !Array.isArray(data.tweets)) {
        console.error('Unexpected response format:', data);
        return [];
      }

      // Extract pump.fun URLs from tweets and transform them
      const tweetsWithPumpLinks = data.tweets
        .filter(tweet => 
          tweet.entities.urls.some(url => 
            url.expanded_url.includes('pump.fun/coin/')
          )
        )
        .map(this.transformTweet);

      if (tweetsWithPumpLinks.length > 0) {
        // Update lastTweetId with the newest tweet's ID
        this.lastTweetId = tweetsWithPumpLinks[0].id_str;
      }

      // After first request, switch to ID-based filtering
      this.isFirstRequest = false;

      return tweetsWithPumpLinks;
    } catch (error) {
      console.error('Error fetching tweets:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
      }
      return [];
    }
  }
}
