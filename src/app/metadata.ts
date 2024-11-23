import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'socialsnipe.fun',
  description: 'Solana Token Trading Bot - Real-time token monitoring and auto-buy capabilities',
  icons: {
    icon: [{ url: '🔫', type: 'image/svg+xml' }],
  },
  openGraph: {
    title: 'socialsnipe.fun',
    description: 'Solana Token Trading Bot - Real-time token monitoring and auto-buy capabilities',
    url: 'https://socialsnipe.fun',
    siteName: 'socialsnipe.fun',
    images: [
      {
        url: 'https://socialsnipe.fun/social-share.svg',
        width: 1200,
        height: 630,
        alt: 'socialsnipe.fun - Solana Token Trading Bot',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'socialsnipe.fun',
    description: 'Solana Token Trading Bot - Real-time token monitoring and auto-buy capabilities',
    creator: '@SocialSnipeSol',
    images: ['https://socialsnipe.fun/social-share.svg'],
  },
};
