import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="ja">
      <Head>
        {/* Tailwind CSS (CDN) */}
        <script src="https://cdn.tailwindcss.com"></script>

        {/* Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link
          href="https://fonts.googleapis.com/css2?family=DotGothic16&family=Press+Start+2P&family=Yuji+Syuku&display=swap"
          rel="stylesheet"
        />

        {/* ABCJS (楽譜描画ライブラリ) */}
        <script src="https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.4.0/abcjs-basic-min.min.js"></script>
      </Head>
      <body className="min-h-screen pb-12 antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
