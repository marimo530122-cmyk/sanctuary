import type { Metadata } from "next";
import { Noto_Serif_JP } from "next/font/google";
import "./globals.css";

const notoSerif = Noto_Serif_JP({
  variable: "--font-serif-jp",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "Sanctuary",
  description: "非言語オーディオシェルター",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${notoSerif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#07070a] text-[#e8e6e1]">{children}</body>
    </html>
  );
}
