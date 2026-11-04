import './globals.css';
import { Providers } from './providers';
import { PageTransitions } from './page-transitions';

export const metadata = {
  title: 'Canvas — Estudios de forma',
  description: 'Un estudio de composición, profundidad y movimiento.',
};

export const siteConfig: Record<string, string> = {
  language: 'es',
  theme: 'light',
  customHead: '',
  customBody: '',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        {siteConfig.customHead ? (
          <div data-custom-code="head" style={{ display: 'contents' }} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: siteConfig.customHead }} />
        ) : null}
        <Providers><PageTransitions>{children}</PageTransitions></Providers>
        {siteConfig.customBody ? (
          <div data-custom-code="body" style={{ display: 'contents' }} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: siteConfig.customBody }} />
        ) : null}
      </body>
    </html>
  );
}
