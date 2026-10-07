import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '국가별 미국 국채 보유현황 | TIC Monitor',
  description: '미국 재무부 TIC 실제 데이터 기반 국가별 미국채 보유액 및 수요 변화 분석',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <body>
        {children}
      </body>
    </html>
  );
}
