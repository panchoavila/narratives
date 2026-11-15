import { EDITORIAL_PRESET_IDS } from '../../../../packages/revyme-runtime-scene/src/editorial/presets';

// The Editorial Flow code component: a thin editor adapter over `RevymeFlow` from the runtime, which
// does the layout and painting. Its props are flat so each can be bound to a CMS field on a detail
// page (`headline={item.title}`, `source={item.body}`) and edited from the property panel.

const PRESET_LABELS: Record<string, string> = {
  'cover-story': 'Cover story',
  profile: 'Profile',
  interview: 'Interview',
  report: 'Report',
  review: 'Review',
  letter: 'Letter',
  plate: 'Plate',
};

const DEFAULT_SOURCE = 'Write the piece here in Markdown. A blank line starts a new paragraph, a line that starts with ## is a crosshead, and a line that starts with > is a pull quote.\n\nThe layout decides the columns, the size of the type and where every picture and quote goes, for every screen the piece is read on.';

const text = (label: string, value: string) => ({ type: 'text', label, default: value });
const weight = (label: string, value: number) => ({ type: 'number', label, min: 100, max: 900, step: 100, default: value });

const controls = {
  children: {
    type: 'slot',
    label: 'Objects',
    slotMax: 'infinite',
    description: 'Pictures, ads or designed frames that join the flow. Select one to place it under Editorial flow.',
  },
  preset: {
    type: 'select',
    label: 'Layout',
    default: 'cover-story',
    options: EDITORIAL_PRESET_IDS.map((value) => ({ value, label: PRESET_LABELS[value] ?? value })),
  },
  direction: {
    type: 'select',
    label: 'Pages',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Follow page' },
      { value: 'down', label: 'Down' },
      { value: 'across', label: 'Across' },
    ],
    description: 'Follow page: across where the page scrolls sideways (Page Flow), down elsewhere.',
  },
  content: { type: 'group', label: 'Content', controls: {
    kicker: text('Kicker', 'Feature'),
    headline: text('Headline', 'The headline of the piece'),
    deck: text('Deck', 'One or two sentences that tell the reader why to keep going.'),
    byline: text('Byline', 'By the writer'),
    source: { ...text('Body', DEFAULT_SOURCE), description: 'Markdown: paragraphs, ## crossheads, *italic*, **bold**, [links](url), > pull quotes, ![pictures](src "caption").' },
    badge: text('Badge', ''),
    signature: text('Signature', ''),
  } },
  picture: { type: 'group', label: 'Picture', controls: {
    heroSrc: { type: 'upload', label: 'Image', default: '' },
    heroAlt: text('Description', ''),
    heroCaption: text('Caption', ''),
    heroAspect: { type: 'number', label: 'Aspect', min: 0, max: 5, step: 0.05, default: 0, description: 'Width divided by height. 0 lets the layout decide.' },
  } },
  type: { type: 'group', label: 'Type', controls: {
    displayFont: { type: 'font', label: 'Display', default: 'Georgia, serif' },
    displayWeight: weight('Display weight', 700),
    sansFont: { type: 'font', label: 'Labels', default: '"Helvetica Neue", Arial, sans-serif' },
    sansWeight: weight('Labels weight', 600),
    serifFont: { type: 'font', label: 'Body', default: 'Georgia, serif' },
    serifWeight: weight('Body weight', 400),
  } },
  page: { type: 'group', label: 'Page', controls: {
    paper: { type: 'color', label: 'Paper', default: '#ffffff' },
    ink: { type: 'color', label: 'Ink', default: '#141414' },
    folios: { type: 'toggle', label: 'Page numbers', default: true },
    locale: {
      type: 'select',
      label: 'Language',
      default: 'en',
      options: [{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' }],
    },
  } },
};

/** Thin editor adapter. Layout and painting ship in the shared runtime. */
export const EDITORIAL_FLOW_COMPONENT = `'use client';

/** @label "Editorial Flow" */
/** @comment "Lay a long piece out like a magazine: columns, fitted headlines, drop caps and pull quotes, for every screen. Bind its fields to a CMS item." */
/** @defaultWidth 1200 */
/** @defaultHeight 900 */
/** @controls ${JSON.stringify(controls, null, 2)} */

import { Children, cloneElement, isValidElement } from 'react';
import { RevymeFlow, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

type CSSProperties = import('react').CSSProperties;

interface EditorialFlowProps {
  preset?: string;
  direction?: 'auto' | 'down' | 'across';
  kicker?: string;
  headline?: string;
  deck?: string;
  byline?: string;
  source?: string;
  badge?: string;
  signature?: string;
  heroSrc?: string;
  heroAlt?: string;
  heroCaption?: string;
  heroAspect?: number;
  displayFont?: string;
  displayWeight?: number;
  sansFont?: string;
  sansWeight?: number;
  serifFont?: string;
  serifWeight?: number;
  paper?: string;
  ink?: string;
  folios?: boolean;
  locale?: string;
  style?: CSSProperties;
  children?: import('react').ReactNode;
}

function EditorialFlow({
  preset = 'cover-story',
  direction = 'auto',
  kicker = '',
  headline = '',
  deck = '',
  byline = '',
  source = '',
  badge = '',
  signature = '',
  heroSrc = '',
  heroAlt = '',
  heroCaption = '',
  heroAspect = 0,
  displayFont = 'Georgia, serif',
  displayWeight = 700,
  sansFont = '"Helvetica Neue", Arial, sans-serif',
  sansWeight = 600,
  serifFont = 'Georgia, serif',
  serifWeight = 400,
  paper = '#ffffff',
  ink = '#141414',
  folios = true,
  locale = 'en',
  style,
  children,
  ...props
}: EditorialFlowProps) {
  const inCanvas = useStaticCanvas();
  // Connected elements arrive with their canvas-workspace placement; the flow gives each its box.
  const objects = Children.map(children, (child) => isValidElement<{ style?: CSSProperties }>(child)
    ? cloneElement(child, { style: { ...child.props.style, position: 'relative', left: 'auto', top: 'auto',
        right: 'auto', bottom: 'auto', margin: 0 } })
    : child);
  // On the canvas the instance's wrapper is its box: sized per breakpoint, with viewport units
  // resolved for the device the tile simulates. The style forwarded inside is the base one, the
  // same on every tile and unresolved (100svh would measure the editor's window), so there the
  // flow fills its wrapper instead.
  const box = inCanvas ? { ...style, width: '100%', height: '100%' } : style;
  return (
    <RevymeFlow
      {...props}
      style={box}
      inCanvas={inCanvas}
      preset={preset}
      mode={direction === 'across' ? 'paged-x' : direction === 'down' ? 'paged-y' : 'auto'}
      piece={{
        kicker,
        headline,
        deck,
        byline,
        body: source,
        badge,
        signature,
        hero: heroSrc ? { src: heroSrc, alt: heroAlt, caption: heroCaption, aspect: heroAspect > 0 ? heroAspect : undefined } : null,
      }}
      theme={{
        display: { family: displayFont, weight: displayWeight },
        sans: { family: sansFont, weight: sansWeight },
        serif: { family: serifFont, weight: serifWeight },
      }}
      locale={locale}
      paper={paper}
      ink={ink}
      folios={folios}
    >
      {objects}
    </RevymeFlow>
  );
}
export default withResponsiveProps(EditorialFlow);
`;
