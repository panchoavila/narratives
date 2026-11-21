import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { collectPortableForms, makePortableFormFiles, PORTABLE_FORM_HANDLER } from './portable-forms';

describe('portable forms', () => {
  const source = `<form data-id="lead" data-form='{"sendTo":[{"type":"email","recipient":"owner@example.test"},{"type":"sheet","sheetId":"sheet","sheetName":"Hoja 1"}],"redirect":"/gracias"}'><input name="Email"/><input name="first_name"/></form>`;
  it('extracts editable form config and refuses duplicate identities', () => {
    const forms = collectPortableForms({ 'app/a.tsx': source });
    expect(forms.lead).toMatchObject({ redirect: '/gracias', sendTo: [{ type: 'email' }, { type: 'sheet' }] });
    expect(() => collectPortableForms({ 'app/a.tsx': source, 'app/b.tsx': source })).toThrow('Duplicate form ID');
    expect(makePortableFormFiles(forms)['app/api/form/route.js']).toContain("runtime = 'nodejs'");
  });
  it('sends to both configured destinations with RAW header-aligned values', async () => {
    const code = 'data:text/javascript;base64,' + Buffer.from(PORTABLE_FORM_HANDLER).toString('base64');
    const { handleForm } = await import(/* @vite-ignore */ code);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = { RESEND_API_KEY: 'test', MAIL_FROM: 'test@example.test', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.test', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return Response.json({ access_token: 'test' });
      if (url.includes('A1%3AZZ1') && !url.includes(':append')) return Response.json({ values: [['Email', 'first_name', 'unknown']] });
      return Response.json({ ok: true });
    };
    const req = new Request('http://localhost/api/form', { method: 'POST', body: JSON.stringify({ formId: 'lead', fields: { first_name: '=safe', Email: 'a@example.test' }, sendTo: [{ type: 'email', recipient: 'attacker@example.test' }] }) });
    const res = await handleForm(req, collectPortableForms({ 'app/a.tsx': source }), env, fetcher);
    expect(await res.json()).toEqual({ ok: true, redirect: '/gracias' });
    expect(calls).toHaveLength(4);
    expect(JSON.parse(calls[2].init.body as string).to).toEqual(['owner@example.test']);
    expect(calls[3].url).toContain('valueInputOption=RAW');
    expect(JSON.parse(calls[3].init.body as string).values).toEqual([['a@example.test', '=safe', '']]);
  });

  it('fills a configured existing timestamp column without modifying headers', async () => {
    const code = 'data:text/javascript;base64,' + Buffer.from(PORTABLE_FORM_HANDLER).toString('base64');
    const { handleForm } = await import(/* @vite-ignore */ code);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.test', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    let row: string[] = [], calls = 0;
    const fetcher = async (url: string, init: RequestInit = {}) => {
      calls++;
      if (url.includes('oauth2')) return Response.json({ access_token: 'test' });
      if (!url.includes(':append')) return Response.json({ values: [['Date', 'Email']] });
      row = JSON.parse(init.body as string).values[0]; return Response.json({});
    };
    const configs = { n: { sendTo: [{ type: 'sheet', sheetId: 'id', sheetName: 'Tab', timestampField: 'Date' }], allowedFields: ['Email'] } };
    const req = new Request('http://localhost/api/form', { method: 'POST', body: JSON.stringify({ formId: 'n', fields: { Email: 'a@example.test' } }) });
    expect((await handleForm(req, configs, env, fetcher)).status).toBe(200);
    expect(calls).toBe(3); expect(row[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(row[1]).toBe('a@example.test');
  });
  it('does not send anything when the sheet lacks a populated field column', async () => {
    const code = 'data:text/javascript;base64,' + Buffer.from(PORTABLE_FORM_HANDLER).toString('base64');
    const { handleForm } = await import(/* @vite-ignore */ code);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = { RESEND_API_KEY: 'test', MAIL_FROM: 'test@example.test', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.test', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return url.includes('oauth2') ? Response.json({ access_token: 'test' }) : Response.json({ values: [['Email']] });
    };
    const req = new Request('http://localhost/api/form', { method: 'POST', body: JSON.stringify({ formId: 'lead', fields: { first_name: 'Test', Email: 'a@example.test' } }) });
    expect((await handleForm(req, collectPortableForms({ 'app/a.tsx': source }), env, fetcher)).status).toBe(502);
    expect(calls).toHaveLength(2);
    expect(calls.some(url => url.includes('resend') || url.includes(':append'))).toBe(false);
  });
  it('validates required values and email on the server before calling a provider', async () => {
    const code = 'data:text/javascript;base64,' + Buffer.from(PORTABLE_FORM_HANDLER).toString('base64');
    const { handleForm } = await import(/* @vite-ignore */ code);
    const form = `<form data-id="valid" data-form='{"sendTo":[{"type":"email","recipient":"owner@example.test"}]}'><input name="Email" type="email" required /></form>`;
    const configs = collectPortableForms({ 'a.tsx': form });
    const send = (fields: object) => handleForm(new Request('http://localhost/api/form', { method: 'POST', body: JSON.stringify({ formId: 'valid', fields }) }), configs, {}, async () => { throw new Error('must not send'); });
    expect((await send({ Email: '' })).status).toBe(400);
    expect((await send({ Email: 'invalid' })).status).toBe(400);
    expect((await send({ Email: 'bad space@example.test' })).status).toBe(400);
    expect((await send({ Email: 'ok@example.test' })).status).toBe(502);
  });
  it('reports failure and does not claim success for missing credentials or unknown forms', async () => {
    const code = 'data:text/javascript;base64,' + Buffer.from(PORTABLE_FORM_HANDLER).toString('base64');
    const { handleForm } = await import(/* @vite-ignore */ code);
    const request = (formId: string) => new Request('http://localhost/api/form', { method: 'POST', body: JSON.stringify({ formId, fields: {} }) });
    const fetcher = async () => { throw new Error('network must not be called'); };
    expect((await handleForm(request('unknown'), collectPortableForms({ 'a.tsx': source }), {}, fetcher)).status).toBe(400);
    expect((await handleForm(request('lead'), collectPortableForms({ 'a.tsx': source }), {}, fetcher)).status).toBe(502);
  });
});
