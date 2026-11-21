import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevymeAlternatingRows, alternatingRowsCss } from '../../../packages/revyme-runtime-scene/src/alternating-rows';
import { RevymeRichContent } from '../../../packages/revyme-runtime-scene/src/rich-content';
import { ALTERNATING_ROWS_COMPONENT } from './default-code-components/AlternatingRows';
import { CMS_CONTENT_COMPONENT } from './default-code-components/CMSContent';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';

describe('editable editorial layout treatments', () => {
  it('keeps alternating row content semantic and configures selectors without injecting arbitrary CSS', () => {
    const html = renderToStaticMarkup(<RevymeAlternatingRows targetId="list" itemTargetId="article"><section data-id="list"><article data-id="article">Content</article></section></RevymeAlternatingRows>);
    expect(html).toContain('flex-direction:row-reverse!important');
    expect(html).toContain('<article data-id="article">Content</article>');
    expect(alternatingRowsCss('.scope', 'x"]{color:red}', '', 'odd', 'row-reverse')).toBe('');
    const pinned = alternatingRowsCss('.scope', 'list', 'article', 'odd', 'column-reverse', 'badge', 'top', 'bottom', 20);
    expect(pinned).toContain('[data-id="badge"]'); expect(pinned).toContain('top:auto!important;bottom:20px!important');
    expect(alternatingRowsCss('.scope','list','article','odd','column-reverse','bad"]{color:red}', 'top','bottom',20)).not.toContain('color:red');
    expect(alternatingRowsCss('.scope','list','article','odd','column-reverse','badge','top','top',20)).not.toContain('top:auto');
    expect(renderToStaticMarkup(<RevymeAlternatingRows enabled={false}>Content</RevymeAlternatingRows>)).not.toContain('flex-direction');
  });
  it('exposes alternation and text column settings through code component controls', () => {
    expect(Object.keys(parseComponentControlsMeta(ALTERNATING_ROWS_COMPONENT)!.controls)).toEqual(['children','targetId','itemTargetId','itemPinnedTargetId','pinFrom','pinTo','pinOffset','enabled','parity','direction']);
    const controls = parseComponentControlsMeta(CMS_CONTENT_COMPONENT)!.controls;
    expect(controls.columns.default).toBe(1);
    expect(controls.columnGap.default).toBe(20);
    expect(controls.hyphens.default).toBe('manual');
    for (const [path, source] of [['AlternatingRows', ALTERNATING_ROWS_COMPONENT], ['CMSContent', CMS_CONTENT_COMPONENT]]) {
      expect(checkFile(source, { kind: 'code-component', path: `components/${path}.tsx` })).toEqual([]);
    }
  });
  it('renders text columns and hyphenation while preserving paragraph semantics', () => {
    const html = renderToStaticMarkup(<RevymeRichContent html="<p>Primero</p><p>Segundo</p>" columns={2} columnGap={20} hyphens="auto" lang="es" />);
    expect(html).toContain('column-count:2'); expect(html).toContain('column-gap:20px'); expect(html).toContain('hyphens:auto');
    expect(html).toContain('Primero</p><p');
  });
});
