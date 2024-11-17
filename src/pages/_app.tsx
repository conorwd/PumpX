import type { AppProps } from 'next/app';
import '../styles/globals.css';
import Head from 'next/head';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Pump Fun Twitter Bot</title>
        <meta name="description" content="Real-time Solana token tracking with Twitter integration" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="min-h-screen bg-gray-900">
        <Component {...pageProps} />
      </div>
    </>
  );
}
